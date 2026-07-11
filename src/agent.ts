import { existsSync, readFileSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import {
	Client,
	type ListenerEventData,
	MessageCreateListener,
	Routes
} from "@buape/carbon"
import { createServer } from "@buape/carbon/adapters/bun"
import { GatewayIntents, GatewayPlugin } from "@buape/carbon/gateway"
import {
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	ModelRegistry,
	SessionManager,
	SettingsManager
} from "@earendil-works/pi-coding-agent"
import {
	clearPostMigrationPrompts,
	config,
	memoryPath,
	readPostMigrationPrompts,
	workspace
} from "./config"
import { createReactionListeners } from "./listeners/reactions"
import { cattySystemPrompt } from "./prompt"
import { createDiscordTool } from "./tools/discord"
import { createMemoryTool } from "./tools/memory"

export async function startCatty(options?: { newSession?: boolean }) {
	const agentDir = String(config.pi?.agentDir ?? getAgentDir()).replace(
		/^~(?=$|\/)/,
		homedir()
	)
	const heartbeatPath = join(
		workspace,
		config.heartbeat?.file ?? "HEARTBEAT.md"
	)
	console.log(`[catty] QMD memory loaded into pi context: ${memoryPath}`)
	console.log(
		`[catty] system prompt sent to pi:\n---\n${cattySystemPrompt}\n---`
	)

	const authStorage = AuthStorage.create(join(agentDir, "auth.json"))

	for (const [provider, key] of Object.entries(config.pi?.apiKeys ?? {})) {
		if (typeof key === "string") authStorage.setRuntimeApiKey(provider, key)
	}

	const modelRegistry = ModelRegistry.create(
		authStorage,
		join(agentDir, "models.json")
	)
	const model =
		config.pi?.provider && config.pi?.model
			? modelRegistry.find(config.pi.provider, config.pi.model)
			: undefined
	if (config.pi?.provider && config.pi?.model && !model)
		throw new Error(
			`Unknown pi model: ${config.pi.provider}/${config.pi.model}`
		)

	const settingsManager = SettingsManager.create(workspace, agentDir, {
		projectTrusted: false
	})
	const resourceLoader = new DefaultResourceLoader({
		cwd: workspace,
		agentDir,
		settingsManager,
		additionalSkillPaths: [join(workspace, "skills")],
		additionalExtensionPaths: [join(workspace, ".pi/extensions")],
		agentsFilesOverride: (current) => ({
			agentsFiles: [
				...current.agentsFiles.filter(
					(file) => file.path !== memoryPath
				),
				{ path: memoryPath, content: readFileSync(memoryPath, "utf8") }
			]
		}),
		systemPromptOverride: () => cattySystemPrompt,
		appendSystemPromptOverride: () => []
	})
	await resourceLoader.reload()

	const memoryTool = createMemoryTool(workspace, memoryPath)
	const runPostMigrationPrompts = async () => {
		const prompts = readPostMigrationPrompts()
		if (prompts.length === 0) return
		console.log(
			`[migration] running ${prompts.length} post-migration prompt(s) in side session`
		)
		const { session: migrationSession, modelFallbackMessage } =
			await createAgentSession({
				cwd: workspace,
				agentDir,
				authStorage,
				modelRegistry,
				resourceLoader,
				settingsManager,
				customTools: [memoryTool],
				sessionManager: SessionManager.inMemory(workspace),
				...(model ? { model } : {}),
				...(config.pi?.thinking
					? { thinkingLevel: config.pi.thinking }
					: {})
			})
		if (modelFallbackMessage)
			console.log(`[migration] ${modelFallbackMessage}`)
		let text = ""
		let thinking = ""
		const unsubscribe = migrationSession.subscribe((event) => {
			if (event.type === "message_update") {
				if (event.assistantMessageEvent.type === "text_delta")
					text += event.assistantMessageEvent.delta
				if (event.assistantMessageEvent.type === "thinking_delta")
					thinking += event.assistantMessageEvent.delta
				return
			}
			if (event.type === "tool_execution_start")
				console.log(`[migration] tool start: ${event.toolName}`)
			else if (event.type === "tool_execution_end")
				console.log(
					`[migration] tool end: ${event.toolName} ${event.isError ? "error" : "ok"}`
				)
			else if (event.type === "turn_start")
				console.log("[migration] turn started")
			else if (event.type === "turn_end")
				console.log("[migration] turn finished")
		})
		try {
			for (const prompt of prompts) {
				text = ""
				thinking = ""
				const migrationPrompt = `Catty post-migration side session. This is trusted migration guidance, not a Discord message. Complete the requested workspace cleanup, then summarize what changed.\n\n${prompt.prompt}`
				console.log(`[migration] prompt: ${prompt.title}`)
				await migrationSession.prompt(migrationPrompt)
				if (thinking.trim())
					console.log(
						`[migration] thinking:\n---\n${thinking.trim()}\n---`
					)
				console.log(
					`[migration] final response:\n---\n${text.trim() || "No text response."}\n---`
				)
			}
			clearPostMigrationPrompts()
		} finally {
			unsubscribe()
			migrationSession.dispose()
		}
		await resourceLoader.reload()
		console.log("[migration] finished; starting main session")
	}
	await runPostMigrationPrompts()

	const applicationResponse = await fetch(
		"https://discord.com/api/v10/oauth2/applications/@me",
		{ headers: { Authorization: `Bot ${config.token}` } }
	)
	if (!applicationResponse.ok)
		throw new Error(
			`Could not fetch Discord application info: HTTP ${applicationResponse.status}`
		)
	const application = await applicationResponse.json()
	if (
		!application ||
		typeof application !== "object" ||
		!("id" in application) ||
		!("verify_key" in application)
	)
		throw new Error("Discord application info missing id or public key")

	let client: Client
	const discordTool = createDiscordTool(() => client)

	const { session, modelFallbackMessage } = await createAgentSession({
		cwd: workspace,
		agentDir,
		authStorage,
		modelRegistry,
		resourceLoader,
		settingsManager,
		customTools: [discordTool, memoryTool],
		sessionManager: options?.newSession
			? SessionManager.create(workspace)
			: SessionManager.continueRecent(workspace),
		...(model ? { model } : {}),
		...(config.pi?.thinking ? { thinkingLevel: config.pi.thinking } : {})
	})
	if (modelFallbackMessage) console.log(`[pi] ${modelFallbackMessage}`)
	console.log(`[pi] session: ${session.sessionFile ?? session.sessionId}`)

	let heartbeatSession = session
	if (
		config.heartbeat?.enabled === true &&
		(config.heartbeat?.session ?? "separate") === "separate"
	) {
		const {
			session: separateHeartbeatSession,
			modelFallbackMessage: heartbeatModelFallbackMessage
		} = await createAgentSession({
			cwd: workspace,
			agentDir,
			authStorage,
			modelRegistry,
			resourceLoader,
			settingsManager,
			customTools: [discordTool, memoryTool],
			sessionManager: SessionManager.inMemory(workspace),
			...(model ? { model } : {}),
			...(config.pi?.thinking
				? { thinkingLevel: config.pi.thinking }
				: {})
		})
		heartbeatSession = separateHeartbeatSession
		if (heartbeatModelFallbackMessage)
			console.log(`[heartbeat] ${heartbeatModelFallbackMessage}`)
		console.log(
			`[heartbeat] session: ${heartbeatSession.sessionFile ?? heartbeatSession.sessionId}`
		)
	}

	const piJobs: Array<{
		run: () => Promise<void>
		lowPriority: boolean
		resolve: () => void
		reject: (error: unknown) => void
	}> = []
	let piRunning = false
	const runPiJobs = async () => {
		if (piRunning) return
		piRunning = true
		try {
			while (piJobs.length > 0) {
				const normalIndex = piJobs.findIndex((job) => !job.lowPriority)
				const [job] = piJobs.splice(
					normalIndex === -1 ? 0 : normalIndex,
					1
				)
				if (!job) continue
				try {
					await job.run()
					job.resolve()
				} catch (error) {
					job.reject(error)
				}
			}
		} finally {
			piRunning = false
		}
	}
	const enqueuePi = (
		run: () => Promise<void>,
		options?: { lowPriority?: boolean }
	) =>
		new Promise<void>((resolve, reject) => {
			const lowPriority = options?.lowPriority === true
			piJobs.push({
				run,
				lowPriority,
				resolve,
				reject
			})
			if (lowPriority) setTimeout(() => void runPiJobs(), 1500)
			else void runPiJobs()
		})

	const allowedDiscordUser = async (
		guildId: string | undefined,
		channelId: string,
		userId: string,
		roleIds: string[]
	) => {
		const auth = config.auth ?? {}
		let roles = roleIds
		if (guildId && roles.length === 0) {
			try {
				roles = (await client.fetchMember(guildId, userId)).roles.map(
					(role) => role.id
				)
			} catch {}
		}

		if (!guildId) {
			return auth.users === undefined ? true : auth.users.includes(userId)
		}
		if (auth.guilds === undefined) return true

		const guild = auth.guilds[guildId]
		const channel =
			guild?.channels === undefined
				? undefined
				: guild.channels[channelId]
		const guildPrincipalAllowed = guild
			? guild.users === undefined && guild.roles === undefined
				? true
				: (guild.users?.includes(userId) ?? false) ||
					(guild.roles?.some((role: string) =>
						roles.includes(role)
					) ??
						false)
			: false
		const channelPrincipalAllowed = channel
			? channel.users === undefined && channel.roles === undefined
				? true
				: (channel.users?.includes(userId) ?? false) ||
					(channel.roles?.some((role: string) =>
						roles.includes(role)
					) ??
						false)
			: guild?.channels === undefined
		return (
			Boolean(guild) && guildPrincipalAllowed && channelPrincipalAllowed
		)
	}

	class AssistantMessage extends MessageCreateListener {
		async handle(
			data: ListenerEventData["MESSAGE_CREATE"],
			client: Client
		) {
			if (data.author.id === client.options.clientId) {
				return
			}

			console.log("[discord] message received", {
				id: data.message.id,
				channelId: data.message.channelId,
				guildId: data.guild?.id ?? data.guild_id,
				authorId: data.author.id,
				author: data.author.username,
				content: data.content,
				attachments: data.rawMessage.attachments?.length ?? 0,
				referencedMessageId: data.rawMessage.referenced_message?.id
			})

			const guildId = data.guild?.id ?? data.guild_id
			const allowed = await allowedDiscordUser(
				guildId,
				data.message.channelId,
				data.author.id,
				data.rawMember?.roles ?? []
			)

			if (!allowed) {
				console.log(
					"[discord] ignored unauthorized message",
					data.message.id
				)
				return
			}

			const mode =
				config.responses?.channels?.[data.message.channelId] ??
				config.responses?.default ??
				"all"
			const prefix = config.responses?.prefix ?? "!catty"
			let content = data.content.trim()
			const attachments = data.rawMessage.attachments ?? []

			if (mode === "prefix") {
				if (!content.startsWith(prefix)) {
					console.log("[discord] ignored missing prefix", {
						id: data.message.id,
						prefix
					})
					return
				}
				content = content.slice(prefix.length).trim()
			}

			if (mode === "mention-or-reply") {
				const mentioned = data.rawMessage.mentions?.some(
					(user: { id: string }) =>
						user.id === client.options.clientId
				)
				const replied =
					data.rawMessage.referenced_message?.author?.id ===
					client.options.clientId
				if (!mentioned && !replied) {
					console.log(
						"[discord] ignored not mention/reply",
						data.message.id
					)
					return
				}
				content = content
					.replace(
						new RegExp(`<@!?${client.options.clientId}>`, "g"),
						""
					)
					.trim()
			}

			if (!content && attachments.length === 0) {
				console.log("[discord] ignored empty content", data.message.id)
				return
			}

			let stopTyping = () => {}
			const startTyping = () => {
				const trigger = () =>
					client.rest
						.post(Routes.channelTyping(data.message.channelId), {})
						.catch(console.error)
				trigger()
				const interval = setInterval(trigger, 8000)
				stopTyping = () => clearInterval(interval)
			}
			startTyping()

			let attachmentTempDir: string | undefined
			const attachmentLines: string[] = []
			const images: Array<{
				type: "image"
				data: string
				mimeType: string
			}> = []

			try {
				if (attachments.length > 0) {
					attachmentTempDir = await mkdtemp(
						join(tmpdir(), "catty-attachments-")
					)
				}

				for (const [index, attachment] of attachments.entries()) {
					const filename = String(
						attachment.filename ?? `attachment-${index}`
					).replace(/[^a-zA-Z0-9._-]/g, "_")
					const filePath = join(
						attachmentTempDir ?? tmpdir(),
						`${index}-${filename}`
					)
					const response = await fetch(attachment.url)
					if (!response.ok)
						throw new Error(
							`Failed to download attachment ${filename}: HTTP ${response.status}`
						)
					const buffer = Buffer.from(await response.arrayBuffer())
					await writeFile(filePath, buffer)
					const mimeType =
						attachment.content_type ??
						response.headers.get("content-type") ??
						"application/octet-stream"

					attachmentLines.push(
						`- Filename: ${attachment.filename ?? filename}\n  Content-Type: ${mimeType}\n  Size: ${attachment.size ?? buffer.byteLength} bytes\n  Local-Path: ${filePath}`
					)
					if (mimeType.startsWith("image/")) {
						images.push({
							type: "image",
							data: buffer.toString("base64"),
							mimeType
						})
					}
				}
			} catch (error) {
				console.error("[discord] attachment download failed", error)
				stopTyping()
				if (attachmentTempDir)
					await rm(attachmentTempDir, {
						recursive: true,
						force: true
					})
				await data.message.reply(
					"Catty could not download one of the attachments. Check service logs."
				)
				return
			}

			const referenced = data.rawMessage.referenced_message
			const boundary = data.message.id
			const replyContext = referenced
				? `\nReply: ${referenced.author?.username ?? "unknown"} (${referenced.author?.id ?? "unknown"})\n<begin_untrusted_replied_message_${boundary}>\n${referenced.content?.trim() || "[no text content]"}\n<end_untrusted_replied_message_${boundary}>`
				: ""
			const attachmentContext = attachmentLines.length
				? `\nAttachments:\n${attachmentLines.join("\n")}`
				: ""
			const piPrompt = `Discord ${data.message.id} from ${data.author.username ?? "unknown"} (${data.author.id}) in ${data.message.channelId}${guildId ? ` guild ${guildId}` : ""}.${replyContext}${attachmentContext}

<begin_untrusted_user_message_${boundary}>
${content || "[no text content]"}
<end_untrusted_user_message_${boundary}>`

			console.log("[pi] prompt queued for message", data.message.id)
			console.log(`[pi] exact prompt:\n---\n${piPrompt}\n---`)

			const job = enqueuePi(async () => {
				console.log("[pi] prompt started", data.message.id)
				let text = ""
				const unsubscribe = session.subscribe((event) => {
					if (
						event.type === "message_update" &&
						event.assistantMessageEvent.type === "text_delta"
					) {
						text += event.assistantMessageEvent.delta
						return
					}
				})

				try {
					await session.prompt(
						piPrompt,
						images.length > 0 ? { images } : undefined
					)
				} finally {
					unsubscribe()
					stopTyping()
					if (attachmentTempDir)
						await rm(attachmentTempDir, {
							recursive: true,
							force: true
						})
				}

				const response =
					text.trim().slice(0, 1900) || "No text response."
				console.log("[pi] final response for message", data.message.id)
				console.log(`[pi] response:\n---\n${response}\n---`)
				if (response === "NO_REPLY") {
					console.log(
						"[discord] suppressed NO_REPLY",
						data.message.id
					)
					return
				}
				const channel = await data.message.fetchChannel()
				if (!channel?.isSendable()) {
					data.message.reply(response)
				} else {
					channel.send(response)
				}
			})

			await job.catch(async (error) => {
				console.error("[pi] error for message", data.message.id, error)
				stopTyping()
				await data.message.reply(
					"Catty hit an error. Check service logs."
				)
			})
		}
	}

	const gateway = new GatewayPlugin({
		intents:
			GatewayIntents.Guilds |
			GatewayIntents.GuildMessages |
			GatewayIntents.GuildMessageReactions |
			GatewayIntents.DirectMessageReactions |
			GatewayIntents.MessageContent
	})

	client = new Client(
		{
			baseUrl: "http://localhost",
			clientId: String(application.id),
			publicKey: String(application.verify_key),
			token: config.token,
			disableDeployRoute: true,
			runtimeProfile: "persistent",
			eventQueue: {
				listenerTimeout: 9999 * 60 * 1000
			}
		},
		{
			listeners: [
				new AssistantMessage(),
				...createReactionListeners({
					getClient: () => client,
					session,
					enqueuePi,
					allowedDiscordUser
				})
			]
		},
		[gateway]
	)

	const server = createServer(client, { port: 3000 })
	let heartbeatQueue = Promise.resolve()

	const heartbeatInterval = setInterval(
		() => {
			if (config.heartbeat?.enabled !== true) return
			if (!existsSync(heartbeatPath)) {
				console.log("[heartbeat] skipped; HEARTBEAT.md not found")
				return
			}

			const heartbeat = readFileSync(heartbeatPath, "utf8").trim()
			if (!heartbeat) {
				console.log("[heartbeat] skipped; HEARTBEAT.md is empty")
				return
			}

			const piPrompt = `Hourly heartbeat from workspace HEARTBEAT.md. Treat this file as trusted workspace guidance.\n\n<begin_heartbeat_md>\n${heartbeat}\n<end_heartbeat_md>`
			console.log("[heartbeat] prompt queued")
			console.log(`[heartbeat] exact prompt:\n---\n${piPrompt}\n---`)

			const runHeartbeat = async () => {
				console.log("[heartbeat] prompt started")
				let text = ""
				const unsubscribe = heartbeatSession.subscribe((event) => {
					if (
						event.type === "message_update" &&
						event.assistantMessageEvent.type === "text_delta"
					) {
						text += event.assistantMessageEvent.delta
						return
					}
					try {
						console.log(
							"[heartbeat] pi event",
							JSON.stringify(event)
						)
					} catch {
						console.log("[heartbeat] pi event", event.type)
					}
				})

				try {
					await heartbeatSession.prompt(piPrompt)
				} finally {
					unsubscribe()
				}

				console.log(
					"[heartbeat] final response:\n---\n" +
						(text.trim() || "No text response.") +
						"\n---"
				)
			}
			const job =
				heartbeatSession === session
					? enqueuePi(runHeartbeat)
					: heartbeatQueue.then(runHeartbeat)
			heartbeatQueue = job.catch(() => {})
			job.catch((error) => console.error("[heartbeat] error", error))
		},
		(config.heartbeat?.intervalMinutes ?? 60) * 60 * 1000
	)

	console.log("Catty running at http://localhost")
	console.log(`Workspace: ${workspace}`)
	console.log(`Heartbeat: ${heartbeatPath}`)

	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.on(signal, () => {
			clearInterval(heartbeatInterval)
			gateway.disconnect()
			if (heartbeatSession !== session) heartbeatSession.dispose()
			session.dispose()
			server.stop()
			process.exit(0)
		})
	}
}
