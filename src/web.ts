import type {
	AgentSession,
	ModelRuntime
} from "@earendil-works/pi-coding-agent"

type WebMode = "Push" | "Wake" | "Always"
type WebStatus =
	| "ready"
	| "queued"
	| "transcribing"
	| "thinking"
	| "speaking"
	| "error"

type WebRuntime = {
	session: AgentSession
	enqueuePi: (
		run: () => Promise<void>,
		options?: { lowPriority?: boolean }
	) => Promise<void>
	promptSession?: (
		text: string,
		options?: Parameters<AgentSession["prompt"]>[1]
	) => Promise<void>
}

type WebConfig = {
	enabled?: boolean
	host?: string
	wakeWord?: string
	defaultMode?: WebMode | "push" | "wake" | "always"
	voice?: {
		provider?: string
		transcribeModel?: string
		speechModel?: string
		voice?: string
	}
}

const textFromAssistant = (message: unknown) =>
	message &&
	typeof message === "object" &&
	"role" in message &&
	message.role === "assistant" &&
	"content" in message &&
	Array.isArray(message.content)
		? message.content
				.filter(
					(block) =>
						block &&
						typeof block === "object" &&
						"type" in block &&
						block.type === "text" &&
						"text" in block &&
						typeof block.text === "string"
				)
				.map((block) => block.text)
				.join("")
		: ""

const finalAssistantText = (messages: unknown[]) =>
	textFromAssistant(
		messages
			.filter(
				(message) =>
					message &&
					typeof message === "object" &&
					"role" in message &&
					message.role === "assistant" &&
					(!("stopReason" in message) ||
						message.stopReason !== "toolUse")
			)
			.at(-1)
	)

export const createCattyWeb = ({
	config,
	modelRuntime,
	getRuntime
}: {
	config?: WebConfig
	modelRuntime: ModelRuntime
	getRuntime: () => Promise<WebRuntime>
}) => {
	const encoder = new TextEncoder()
	const clients = new Set<{ enqueue: (chunk: Uint8Array) => void }>()
	const audio = new Map<
		string,
		{ bytes: Uint8Array; mimeType: string; text: string; createdAt: number }
	>()
	const voice = config?.voice ?? {}
	const defaultMode =
		config?.defaultMode === "Wake" || config?.defaultMode === "wake"
			? "Wake"
			: config?.defaultMode === "Always" ||
					config?.defaultMode === "always"
				? "Always"
				: "Push"
	let promptAbort: (() => void) | undefined
	let abortGeneration = 0
	let audioSequence = 0
	let runSequence = 0
	const state = {
		mode: defaultMode,
		wakeWord: config?.wakeWord ?? "hey catty",
		status: "ready" as WebStatus,
		streamingText: "",
		lastError: "",
		activeRunId: "",
		pending: 0,
		audioChunks: [] as Array<{
			id: string
			url: string
			sequence: number
			text: string
		}>,
		transcript: [] as Array<{
			role: "user" | "assistant"
			text: string
			timestamp: number
		}>
	}

	const snapshot = () => ({
		...state,
		transcript: state.transcript.slice(-40),
		audioChunks: state.audioChunks.slice(-24)
	})
	const send = (
		client: { enqueue: (chunk: Uint8Array) => void },
		event: string,
		data: unknown
	) =>
		client.enqueue(
			encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
		)
	const broadcast = (event = "state", data: unknown = snapshot()) => {
		for (const client of clients) {
			try {
				send(client, event, data)
			} catch {
				clients.delete(client)
			}
		}
	}
	const setStatus = (status: WebStatus, error = "") => {
		state.status = status
		state.lastError = error
		broadcast()
	}
	const json = (data: unknown, init?: ResponseInit) =>
		Response.json(data, {
			...init,
			headers: {
				"Cache-Control": "no-store",
				...init?.headers
			}
		})
	const readJson = async (request: Request) => {
		try {
			return (await request.json()) as Record<string, unknown>
		} catch {
			return {}
		}
	}
	const openAiAuth = async () => {
		const provider = voice.provider ?? "openai"
		const auth = await modelRuntime.getAuth(provider)
		if (!auth?.auth.apiKey && !auth?.auth.headers)
			throw new Error(`No voice auth configured for ${provider}`)
		const headers = new Headers()
		for (const [key, value] of Object.entries(auth.auth.headers ?? {})) {
			if (typeof value === "string") headers.set(key, value)
		}
		if (auth.auth.apiKey)
			headers.set("Authorization", `Bearer ${auth.auth.apiKey}`)
		return {
			baseUrl: (auth.auth.baseUrl ?? "https://api.openai.com/v1").replace(
				/\/+$/,
				""
			),
			headers
		}
	}
	const transcribe = async (file: File) => {
		const auth = await openAiAuth()
		const body = new FormData()
		body.set("model", voice.transcribeModel ?? "gpt-4o-mini-transcribe")
		body.set("file", file, file.name || "catty-voice.webm")
		const response = await fetch(`${auth.baseUrl}/audio/transcriptions`, {
			method: "POST",
			headers: auth.headers,
			body
		})
		if (!response.ok)
			throw new Error(
				`Transcription failed (${response.status}): ${await response.text()}`
			)
		const result = (await response.json()) as { text?: unknown }
		const text = typeof result.text === "string" ? result.text.trim() : ""
		if (!text) throw new Error("Transcription returned no text")
		return text
	}
	const createSpeech = async (
		text: string,
		sequence: number,
		runId: string,
		generation: number
	) => {
		if (state.activeRunId !== runId || generation !== abortGeneration)
			return
		try {
			const auth = await openAiAuth()
			auth.headers.set("Content-Type", "application/json")
			const response = await fetch(`${auth.baseUrl}/audio/speech`, {
				method: "POST",
				headers: auth.headers,
				body: JSON.stringify({
					model: voice.speechModel ?? "gpt-4o-mini-tts",
					voice: voice.voice ?? "alloy",
					input: text,
					response_format: "mp3"
				})
			})
			if (!response.ok)
				throw new Error(
					`Speech failed (${response.status}): ${await response.text()}`
				)
			if (state.activeRunId !== runId || generation !== abortGeneration)
				return
			const id = crypto.randomUUID()
			const bytes = new Uint8Array(await response.arrayBuffer())
			audio.set(id, {
				bytes,
				mimeType: "audio/mpeg",
				text,
				createdAt: Date.now()
			})
			for (const [storedId, item] of audio) {
				if (audio.size <= 48) break
				if (Date.now() - item.createdAt > 30 * 60 * 1000)
					audio.delete(storedId)
			}
			const chunk = {
				id,
				url: `/api/catty/audio/${id}`,
				sequence,
				text
			}
			state.audioChunks.push(chunk)
			state.audioChunks = state.audioChunks.slice(-24)
			broadcast("audio", chunk)
			broadcast()
		} catch (error) {
			if (state.activeRunId !== runId || generation !== abortGeneration)
				return
			state.lastError =
				error instanceof Error ? error.message : String(error)
			broadcast()
		}
	}
	const runPrompt = async (message: string, fromVoice: boolean) => {
		const text = message.trim()
		if (!text) return
		const runId = crypto.randomUUID()
		const sequenceBase = ++runSequence * 1000
		let aborted = false
		const generation = abortGeneration
		state.pending++
		state.activeRunId = runId
		state.streamingText = ""
		state.audioChunks = []
		state.lastError = ""
		state.transcript.push({ role: "user", text, timestamp: Date.now() })
		setStatus("queued")
		promptAbort = () => {
			aborted = true
		}
		const runtime = await getRuntime()
		await runtime
			.enqueuePi(async () => {
				state.pending = Math.max(0, state.pending - 1)
				if (aborted || generation !== abortGeneration) {
					setStatus("ready")
					return
				}
				setStatus("thinking")
				let spoken = ""
				let finalText = ""
				let speechChain = Promise.resolve()
				const queueSpeech = (text: string) => {
					const sequence = sequenceBase + ++audioSequence
					speechChain = speechChain.then(() =>
						createSpeech(text, sequence, runId, generation)
					)
				}
				const unsubscribe = runtime.session.subscribe((event) => {
					if (event.type === "message_update") {
						if (event.assistantMessageEvent.type === "text_delta") {
							const delta = event.assistantMessageEvent.delta
							state.streamingText += delta
							spoken += delta
							broadcast()
							if (fromVoice) {
								const match = spoken.match(
									/^([\s\S]{90,}?[.!?])\s+/
								)
								if (match?.[1]) {
									const chunk = match[1].trim()
									spoken = spoken.slice(match[0].length)
									setStatus("speaking")
									queueSpeech(chunk)
								}
							}
						}
						return
					}
					if (event.type === "agent_end") {
						finalText = finalAssistantText(event.messages).trim()
					}
				})
				try {
					const boundary = runId.replace(/-/g, "")
					const webPrompt = `Catty web ${fromVoice ? "voice" : "text"} message from the LAN web UI.\n\n<begin_untrusted_web_message_${boundary}>\n${text}\n<end_untrusted_web_message_${boundary}>`
					await (runtime.promptSession?.(webPrompt, {
						source: "rpc"
					}) ?? runtime.session.prompt(webPrompt, { source: "rpc" }))
				} finally {
					unsubscribe()
				}
				if (fromVoice && spoken.trim()) {
					setStatus("speaking")
					queueSpeech(spoken.trim())
				}
				if (finalText) {
					state.streamingText = finalText
					state.transcript.push({
						role: "assistant",
						text: finalText,
						timestamp: Date.now()
					})
					state.transcript = state.transcript.slice(-40)
				}
				await speechChain
				if (state.activeRunId === runId) setStatus("ready")
			})
			.catch((error) => {
				state.pending = Math.max(0, state.pending - 1)
				setStatus(
					"error",
					error instanceof Error ? error.message : String(error)
				)
			})
	}
	const abort = async () => {
		promptAbort?.()
		promptAbort = undefined
		abortGeneration++
		state.pending = 0
		state.activeRunId = ""
		state.streamingText = ""
		state.audioChunks = []
		audio.clear()
		broadcast("abort", {})
		const runtime = await getRuntime()
		await runtime.session.abort().catch(() => {})
		setStatus("ready")
	}
	const handleRequest = async (request: Request) => {
		const url = new URL(request.url)
		if (request.method === "GET" && url.pathname === "/") {
			return new Response(page, {
				headers: {
					"Content-Type": "text/html; charset=utf-8",
					"Cache-Control": "no-store"
				}
			})
		}
		if (request.method === "GET" && url.pathname === "/api/catty/state")
			return json(snapshot())
		if (request.method === "GET" && url.pathname === "/api/catty/events") {
			let client: { enqueue: (chunk: Uint8Array) => void } | undefined
			const stream = new ReadableStream({
				start(controller) {
					client = {
						enqueue: (chunk: Uint8Array) =>
							controller.enqueue(chunk)
					}
					clients.add(client)
					send(client, "state", snapshot())
				},
				cancel() {
					if (client) clients.delete(client)
				}
			})
			return new Response(stream, {
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-store, no-transform",
					Connection: "keep-alive"
				}
			})
		}
		if (
			request.method === "GET" &&
			url.pathname.startsWith("/api/catty/audio/")
		) {
			const id = url.pathname.split("/").at(-1) ?? ""
			const item = audio.get(id)
			if (!item) return new Response("Not Found", { status: 404 })
			return new Response(item.bytes, {
				headers: {
					"Content-Type": item.mimeType,
					"Cache-Control": "no-store"
				}
			})
		}
		if (request.method === "POST" && url.pathname === "/api/catty/mode") {
			const body = await readJson(request)
			if (
				body.mode === "Push" ||
				body.mode === "Wake" ||
				body.mode === "Always"
			)
				state.mode = body.mode
			broadcast()
			return json(snapshot())
		}
		if (request.method === "POST" && url.pathname === "/api/catty/prompt") {
			const body = await readJson(request)
			if (typeof body.message !== "string")
				return json({ error: "message required" }, { status: 400 })
			await runPrompt(body.message, body.voice === true)
			return json(snapshot())
		}
		if (request.method === "POST" && url.pathname === "/api/catty/audio") {
			try {
				setStatus("transcribing")
				const form = await request.formData()
				const file = form.get("audio")
				if (!(file instanceof File))
					return json({ error: "audio required" }, { status: 400 })
				const text = await transcribe(file)
				await runPrompt(text, true)
				return json({ text, state: snapshot() })
			} catch (error) {
				setStatus(
					"error",
					error instanceof Error ? error.message : String(error)
				)
				return json({ error: state.lastError }, { status: 500 })
			}
		}
		if (request.method === "POST" && url.pathname === "/api/catty/abort") {
			await abort()
			return json(snapshot())
		}
	}
	const dispose = () => {
		clients.clear()
		audio.clear()
	}
	return { handleRequest, dispose }
}

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Catty</title>
<style>
:root{color-scheme:light;--bg:#f6f6f3;--ink:#161616;--muted:#70706c;--line:#d9d9d2;--panel:#fff;--accent:#111}*{box-sizing:border-box}body{margin:0;min-height:100dvh;background:var(--bg);color:var(--ink);font:15px/1.4 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.app{min-height:100dvh;display:grid;grid-template-rows:auto 1fr auto;padding:22px}.top,.bottom{display:flex;align-items:center;justify-content:space-between;gap:16px}.brand{display:flex;align-items:center;gap:10px;font-weight:650;letter-spacing:-.02em}.mark{display:grid;place-items:center;width:28px;height:28px;border:1px solid var(--ink);border-radius:8px;font-size:12px}.status{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:13px}.dot{width:7px;height:7px;border-radius:50%;background:var(--muted)}.dot.active{background:var(--ink)}button{font:inherit;color:inherit}.icon{border:0;background:transparent;color:var(--muted);padding:9px;border-radius:999px;cursor:pointer}.icon:hover{background:#ecece7;color:var(--ink)}.stage{display:grid;place-items:center;text-align:center;padding:28px 0}.response{min-height:70px;max-width:560px;margin:0 auto 34px;color:var(--ink);font-size:17px;line-height:1.55;text-wrap:pretty}.placeholder{color:var(--muted)}.speak{width:148px;height:148px;border-radius:50%;border:1px solid var(--ink);background:var(--ink);color:var(--bg);font-weight:650;letter-spacing:-.03em;cursor:pointer;transition:transform .15s ease,background .15s ease,color .15s ease}.speak:hover{transform:translateY(-1px)}.speak:active{transform:scale(.98)}.speak.recording{background:var(--bg);color:var(--ink)}.hint{margin-top:18px;color:var(--muted);font-size:13px}.modes{display:flex;gap:2px;padding:3px;border:1px solid var(--line);border-radius:999px;background:#ecece7}.modes button{border:0;background:transparent;color:var(--muted);border-radius:999px;padding:9px 14px;cursor:pointer;font-size:13px}.modes button.active{background:var(--panel);color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.08)}.abort{border:1px solid var(--line);background:transparent;border-radius:999px;padding:9px 14px;color:var(--muted);cursor:pointer}.abort:hover{color:var(--ink);border-color:var(--ink)}dialog{border:0;border-left:1px solid var(--line);padding:0;margin:0 0 0 auto;width:min(420px,100vw);height:100dvh;max-height:none;background:var(--panel);color:var(--ink)}dialog::backdrop{background:rgba(0,0,0,.18)}.sheet{height:100%;display:grid;grid-template-rows:auto auto auto 1fr;gap:18px;padding:22px}.sheet-head{display:flex;align-items:center;justify-content:space-between}.sheet h2{font-size:15px;margin:0}.text{width:100%;min-height:130px;resize:vertical;border:1px solid var(--line);border-radius:16px;background:#fafafa;color:var(--ink);padding:14px;font:inherit}.text:focus{outline:2px solid var(--ink);outline-offset:2px}.send{justify-self:end;border:0;border-radius:999px;background:var(--ink);color:var(--bg);padding:10px 18px;cursor:pointer}.transcript{border-top:1px solid var(--line);padding-top:14px;color:var(--muted);font-size:13px;overflow:auto}.transcript summary{cursor:pointer;color:var(--ink)}.turn{padding:13px 0;border-bottom:1px solid var(--line)}.turn b{display:block;margin-bottom:4px;color:var(--ink);font-size:12px;text-transform:lowercase}.error{color:#a33}@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#151515;--ink:#f1f1ec;--muted:#93938b;--line:#34342f;--panel:#1d1d1a;--accent:#f1f1ec}.icon:hover{background:#242420}.modes{background:#20201d}.text{background:#151515}.modes button.active{box-shadow:none}}@media(max-width:620px){.app{padding:16px}.bottom{align-items:flex-end}.modes{max-width:calc(100vw - 110px);overflow:auto}.speak{width:132px;height:132px}.response{font-size:16px}dialog{border-left:0;width:100vw}}
</style>
</head>
<body>
<div class="app">
<header class="top"><div><div class="brand"><span class="mark">C</span><span>catty</span></div><div class="status"><span id="dot" class="dot"></span><span id="status">Ready</span></div></div><button id="menu" class="icon" aria-label="Open menu">Menu</button></header>
<main class="stage"><div><div id="response" class="response"><span class="placeholder">Say something to start.</span></div><button id="speak" class="speak">Speak</button><div id="hint" class="hint">Push mode. Click once, speak, silence sends.</div></div></main>
<footer class="bottom"><nav id="modes" class="modes" aria-label="Voice mode"><button data-mode="Push">Push</button><button data-mode="Wake">Wake</button><button data-mode="Always">Always</button></nav><button id="abort" class="abort">Abort</button></footer>
</div>
<dialog id="panel"><form method="dialog" class="sheet"><div class="sheet-head"><h2>Text fallback</h2><button class="icon" value="close">Close</button></div><textarea id="draft" class="text" placeholder="Type to Catty…"></textarea><button id="send" class="send" value="send">Send</button><details class="transcript"><summary>Transcript</summary><div id="transcript"></div></details></form></dialog>
<script>
let state={mode:'Push',status:'ready',streamingText:'',transcript:[],wakeWord:'hey catty',lastError:''}
let recorder,chunks=[],recording=false,stream,ctx,analyser,monitorTimer,wake,always=false,playing=false
let audioQueue=[],audioSeen=new Set(),audioSeq=0,currentAudio
const $=id=>document.getElementById(id)
const post=(url,data)=>fetch(url,{method:'POST',headers:data instanceof FormData?undefined:{'Content-Type':'application/json'},body:data instanceof FormData?data:JSON.stringify(data||{})})
function render(){
  $('status').textContent=state.lastError||({ready:'Ready',queued:'Queued',transcribing:'Transcribing',thinking:'Thinking',speaking:'Speaking',error:'Error'}[state.status]||state.status)
  $('status').className=state.lastError?'error':''
  $('dot').className='dot '+(state.status==='ready'?'':'active')
  $('response').innerHTML=state.streamingText?escapeHtml(state.streamingText)+'<span class="placeholder">▋</span>':'<span class="placeholder">Say something to start.</span>'
  document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===state.mode))
  $('speak').textContent=recording?'Listening':state.mode==='Wake'?'Wake':state.mode==='Always'&&always?'Always on':'Speak'
  $('speak').classList.toggle('recording',recording||always)
  $('hint').textContent=state.mode==='Push'?'Push mode. Click once, speak, silence sends.':state.mode==='Wake'?'Wake mode. Keep this tab open; say “'+state.wakeWord+'”.':'Always mode. Click to toggle continuous listening.'
  $('transcript').innerHTML=(state.transcript||[]).slice().reverse().map(t=>'<div class="turn"><b>'+t.role+'</b>'+escapeHtml(t.text)+'</div>').join('')||'<p>No recent conversation.</p>'
}
function escapeHtml(text){return String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function connect(){
  const es=new EventSource('/api/catty/events')
  es.addEventListener('state',e=>{state=JSON.parse(e.data);render();for(const chunk of state.audioChunks||[]) queueAudio(chunk);maybeAlways()})
  es.addEventListener('audio',e=>queueAudio(JSON.parse(e.data)))
  es.addEventListener('abort',()=>stopPlayback())
  es.onerror=()=>setTimeout(()=>{try{es.close()}catch{};connect()},1500)
}
async function setMode(mode){state.mode=mode;render();await post('/api/catty/mode',{mode});if(mode!=='Always')always=false; if(mode==='Wake')startWake()}
async function abort(){stopPlayback();await post('/api/catty/abort');if(always)startRecording()}
async function sendText(){const message=$('draft').value.trim();if(!message)return; $('draft').value=''; $('panel').close(); await post('/api/catty/prompt',{message,voice:false})}
async function clickSpeak(){
  if(state.mode==='Always') { if(state.status!=='ready'){ always=true; await abort(); render(); return } always=!always; if(always) startRecording(); else stopRecording(); render(); return }
  if(state.status!=='ready'){ stopPlayback(); return }
  if(recording) stopRecording(); else startRecording()
}
async function startRecording(){
  if(recording) return
  stopWake()
  stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}})
  const mime=MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':'audio/webm'
  recorder=new MediaRecorder(stream,{mimeType:mime})
  chunks=[]; recording=true; render()
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)}
  recorder.onstop=sendRecording
  recorder.start()
  ctx=new AudioContext(); const source=ctx.createMediaStreamSource(stream); analyser=ctx.createAnalyser(); analyser.fftSize=512; source.connect(analyser)
  let started=Date.now(), silentSince=0
  monitorTimer=setInterval(()=>{const data=new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(data); const avg=data.reduce((a,b)=>a+b,0)/data.length; if(avg<8){silentSince ||= Date.now()} else silentSince=0; if(Date.now()-started>800&&silentSince&&Date.now()-silentSince>1100) stopRecording(); if(Date.now()-started>45000) stopRecording()},120)
}
function stopRecording(){ if(!recording) return; recording=false; clearInterval(monitorTimer); try{recorder.stop()}catch{}; try{stream.getTracks().forEach(t=>t.stop())}catch{}; try{ctx.close()}catch{}; render() }
async function sendRecording(){
  const blob=new Blob(chunks,{type:chunks[0]?.type||'audio/webm'})
  if(blob.size<1200){ maybeAlways(); return }
  const form=new FormData(); form.set('audio',blob,'catty.webm')
  await post('/api/catty/audio',form).catch(()=>{})
}
function startWake(){
  stopWake(); if(state.mode!=='Wake')return
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition
  if(!SR){state.lastError='Wake needs browser speech recognition. Push still works.';render();return}
  wake=new SR(); wake.continuous=true; wake.interimResults=true
  wake.onresult=e=>{let text=''; for(let i=e.resultIndex;i<e.results.length;i++) text+=e.results[i][0].transcript; if(text.toLowerCase().includes((state.wakeWord||'hey catty').toLowerCase())){stopWake(); startRecording()}}
  wake.onend=()=>{if(state.mode==='Wake'&&!recording) setTimeout(startWake,400)}
  try{wake.start()}catch{}
}
function stopWake(){if(wake){wake.onend=null;try{wake.stop()}catch{};wake=null}}
function maybeAlways(){ if(always&&!recording&&!playing&&state.mode==='Always'&&state.status==='ready') setTimeout(()=>{if(always&&!recording&&!playing&&state.status==='ready')startRecording()},500)}
function queueAudio(chunk){ if(audioSeen.has(chunk.id))return; audioSeen.add(chunk.id); audioQueue.push(chunk); audioQueue.sort((a,b)=>a.sequence-b.sequence); playNext() }
function stopPlayback(){ audioQueue=[]; if(currentAudio){currentAudio.pause();currentAudio=null} playing=false; render() }
function playNext(){ if(playing||!audioQueue.length)return; const chunk=audioQueue.shift(); if(!chunk)return; playing=true; currentAudio=new Audio(chunk.url); currentAudio.onended=()=>{playing=false;currentAudio=null;playNext();maybeAlways()}; currentAudio.onerror=()=>{playing=false;currentAudio=null;playNext();maybeAlways()}; currentAudio.play().catch(()=>{playing=false;currentAudio=null}) }
$('menu').onclick=()=>$('panel').showModal(); $('send').onclick=e=>{e.preventDefault();sendText()}; $('abort').onclick=abort; $('speak').onclick=clickSpeak; $('modes').onclick=e=>{const mode=e.target?.dataset?.mode;if(mode)setMode(mode)}
connect(); render()
</script>
</body>
</html>`
