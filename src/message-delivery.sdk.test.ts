import { afterAll, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AssistantMessage } from "@earendil-works/pi-ai"
import { getModels } from "@earendil-works/pi-ai/compat"
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream"
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent"
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager
} from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { ChatDeliveryCoordinator, type ChatEnvelope } from "./message-delivery"

// Every SDK test uses the REAL locked AgentSession/agent loop, only the model's
// streaming transport is scripted. Network calls are a test failure, not a fallback.
const realFetch = globalThis.fetch
globalThis.fetch = (() => {
	throw new Error("Network disabled in SDK steering fixture")
}) as unknown as typeof fetch
afterAll(() => {
	globalThis.fetch = realFetch
})
const gate = () => {
	let resolve = () => {}
	const promise = new Promise<void>((r) => {
		resolve = r
	})
	return { promise, resolve }
}
const textOf = (message: { content: unknown }) =>
	typeof message.content === "string"
		? message.content
		: Array.isArray(message.content)
			? message.content
					.filter((x) => x.type === "text")
					.map((x) => x.text)
					.join("")
			: ""
const envelope = (
	id: string,
	cleanup: () => Promise<void> | void,
	extra: Partial<ChatEnvelope> = {}
): ChatEnvelope => ({
	id,
	channelId: "channel-a",
	guildId: "guild-a",
	authorId: "owner",
	text: `Discord ${id} from owner\nReply context for ${id}\n<begin_untrusted_user_message_${id}>\n${id}\n<end_untrusted_user_message_${id}>`,
	mode: "steer",
	authorized: true,
	responds: true,
	cleanup,
	...extra
})
async function fixture(
	finalText = "A and B handled",
	options: {
		extension?: ExtensionFactory
		mode?: "all" | "one-at-a-time"
		autoCompaction?: boolean
	} = {}
) {
	const dir = await mkdtemp(join(tmpdir(), "sdk-steering-"))
	const settings = SettingsManager.inMemory({
		compaction: {
			enabled: options.autoCompaction ?? false,
			reserveTokens: 128,
			keepRecentTokens: 1
		},
		retry: { enabled: false },
		steeringMode: options.mode ?? "all"
	})
	const modelRuntime = await ModelRuntime.create({
		authPath: join(dir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false
	})
	await modelRuntime.setRuntimeApiKey(
		"anthropic",
		"offline-fixture-not-a-real-credential"
	)
	const loader = new DefaultResourceLoader({
		cwd: dir,
		agentDir: dir,
		settingsManager: settings,
		noExtensions: true,
		extensionFactories: options.extension ? [options.extension] : [],
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPromptOverride: () =>
			"Synthetic offline test. Only use fixture tools."
	})
	await loader.reload()
	const started = gate(),
		release = gate()
	const { session } = await createAgentSession({
		cwd: dir,
		agentDir: dir,
		modelRuntime,
		resourceLoader: loader,
		settingsManager: settings,
		sessionManager: SessionManager.inMemory(dir),
		model: getModels("anthropic")[0],
		tools: ["fixture_wait"],
		customTools: [
			{
				name: "fixture_wait",
				label: "Offline paused tool",
				description:
					"A synthetic paused tool, no network or account access",
				parameters: Type.Object({}),
				execute: async () => {
					started.resolve()
					await release.promise
					return {
						content: [
							{ type: "text", text: "paused tool completed" }
						],
						details: {}
					}
				}
			}
		]
	})
	await session.bindExtensions({})
	let calls = 0
	const contexts: unknown[] = []
	session.agent.streamFunction = (model, context, streamOptions) => {
		contexts.push(structuredClone(context.messages))
		const stream = new AssistantMessageEventStream()
		const first = calls++ === 0
		const aborted = streamOptions?.signal?.aborted === true
		const failed = finalText === "MODEL_ERROR" && !first
		const message: AssistantMessage = {
			role: "assistant",
			content:
				aborted || failed
					? []
					: first
						? [
								{
									type: "toolCall",
									id: "wait-one",
									name: "fixture_wait",
									arguments: {}
								}
							]
						: [{ type: "text", text: finalText }],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input:
					!first && options.autoCompaction
						? model.contextWindow - 1
						: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens:
					!first && options.autoCompaction ? model.contextWindow : 2,
				cost: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					total: 0
				}
			},
			stopReason: aborted
				? "aborted"
				: failed
					? "error"
					: first
						? "toolUse"
						: "stop",
			errorMessage: aborted
				? "Synthetic abort"
				: failed
					? "Synthetic model error"
					: undefined,
			timestamp: Date.now()
		}
		queueMicrotask(() => {
			if (aborted || failed)
				stream.push({
					type: "error",
					reason: aborted ? "aborted" : "error",
					error: message
				})
			else
				stream.push({
					type: "done",
					reason: first ? "toolUse" : "stop",
					message
				})
		})
		return stream
	}
	let chain: Promise<void> = Promise.resolve(),
		generation = 0
	let currentSession = session
	const observeGeneration = (active: typeof session) =>
		active.subscribe((event) => {
			if (event.type === "compaction_start") generation++
		})
	observeGeneration(session)
	const coordinator = new ChatDeliveryCoordinator({
		session: () => currentSession,
		generation: () => generation,
		enqueue: (run) => {
			const next = chain.then(run)
			chain = next.catch(() => {})
			return next
		}
	})
	const sends: Array<{ channel: string; text: string }> = []
	const owner = (input: ChatEnvelope) =>
		coordinator.deliver(input, async (settle) => {
			const session = currentSession
			let text = ""
			const unsubscribe = session.subscribe((event) => {
				if (event.type === "agent_end")
					text = textOf(
						event.messages
							.filter((m) => m.role === "assistant")
							.at(-1) ?? { content: "" }
					)
			})
			try {
				await session.prompt(
					input.text,
					input.images ? { images: input.images } : undefined
				)
				await settle()
				if (text !== "NO_REPLY")
					sends.push({ channel: input.channelId, text })
			} finally {
				unsubscribe()
			}
		})
	return {
		dir,
		get session() {
			return currentSession
		},
		replaceWith: (next: typeof session) => {
			currentSession.dispose()
			generation++
			currentSession = next
			observeGeneration(next)
		},
		coordinator,
		started,
		release,
		contexts,
		sends,
		owner,
		generation: () => {
			generation++
		},
		close: async () => {
			release.resolve()
			await session.abort()
			await coordinator.dispose()
			session.dispose()
			await rm(dir, { recursive: true, force: true })
		}
	}
}

test("real SDK: paused tool consumes B/images/metadata before next model call; one final send and retained files", async () => {
	const f = await fixture()
	let aClean = 0,
		bClean = 0
	try {
		const path = join(f.dir, "B-image.txt")
		await writeFile(path, "fixture attachment")
		const a = f.owner(
			envelope("A", () => {
				aClean++
			})
		)
		await f.started.promise
		const image = {
			type: "image" as const,
			mimeType: "image/png",
			data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1cAAAAASUVORK5CYII="
		}
		const bInput = envelope(
			"B",
			async () => {
				bClean++
				await rm(path)
			},
			{ images: [image] }
		)
		const b = f.owner(bInput)
		await Bun.sleep(10)
		expect(await readFile(path, "utf8")).toBe("fixture attachment")
		expect(bClean).toBe(0)
		f.release.resolve()
		await Promise.all([a, b])
		expect(f.contexts).toHaveLength(2)
		const messages = f.contexts[1] as Array<{
			role: string
			content: Array<{ type: string; text?: string }>
		}>
		expect(messages.some((m) => textOf(m) === bInput.text)).toBe(true)
		expect(
			messages
				.find((m) => textOf(m) === bInput.text)
				?.content.some((p) => p.type === "image")
		).toBe(true)
		expect(f.sends).toEqual([
			{ channel: "channel-a", text: "A and B handled" }
		])
		expect(aClean).toBe(1)
		expect(bClean).toBe(1)
	} finally {
		await f.close()
	}
}, 15000)

test("real SDK: rapid B/C steering and NO_REPLY still have a single response lifecycle", async () => {
	const f = await fixture("NO_REPLY")
	let cleaned = 0
	try {
		const a = f.owner(
			envelope("A", () => {
				cleaned++
			})
		)
		await f.started.promise
		const b = f.owner(
			envelope("B", () => {
				cleaned++
			})
		)
		const c = f.owner(
			envelope("C", () => {
				cleaned++
			})
		)
		f.release.resolve()
		await Promise.all([a, b, c])
		expect(f.sends).toHaveLength(0)
		expect(cleaned).toBe(3)
		expect(
			f.session.messages.filter((m) => m.role === "user").map(textOf)
		).toContain(envelope("C", () => {}).text)
	} finally {
		await f.close()
	}
}, 15000)

test("real SDK: different shared channel/author/guild and queue mode use separate ordered turns", async () => {
	for (const extra of [
		{ channelId: "channel-b" },
		{ authorId: "peer" },
		{ guildId: "guild-b" },
		{ mode: "queue" as const }
	]) {
		const f = await fixture()
		try {
			const a = f.owner(envelope("A", () => {}))
			await f.started.promise
			const b = f.owner(envelope("B", () => {}, extra))
			f.release.resolve()
			await Promise.all([a, b])
			expect(f.contexts).toHaveLength(3)
			expect(f.sends).toHaveLength(2)
			expect(f.sends[1]?.channel).toBe(extra.channelId ?? "channel-a")
		} finally {
			await f.close()
		}
	}
}, 30000)

test("real SDK: denied/filter-ignored messages are not submitted; generation guard queues B", async () => {
	const f = await fixture()
	let cleaned = 0
	try {
		const a = f.owner(envelope("A", () => {}))
		await f.started.promise
		await f.owner(
			envelope(
				"denied",
				() => {
					cleaned++
				},
				{ authorized: false }
			)
		)
		await f.owner(
			envelope(
				"ignored",
				() => {
					cleaned++
				},
				{ responds: false }
			)
		)
		f.generation()
		const b = f.owner(envelope("B", () => {}))
		f.release.resolve()
		await Promise.all([a, b])
		expect(cleaned).toBe(2)
		expect(f.contexts).toHaveLength(3)
		expect(
			f.session.messages.filter((m) => m.role === "user").map(textOf)
		).not.toContain(envelope("denied", () => {}).text)
	} finally {
		await f.close()
	}
}, 15000)

test("real SDK: async input preflight finishing after A starts a continuation owned by A, not stranded B", async () => {
	const entered = gate(),
		allow = gate()
	let clean = 0
	const f = await fixture("late B answer", {
		extension: (pi) => {
			pi.on("input", async (event) => {
				if (event.text.includes("user_message_B>")) {
					entered.resolve()
					await allow.promise
				}
				return { action: "continue" }
			})
		}
	})
	try {
		const a = f.owner(
			envelope("A", () => {
				clean++
			})
		)
		await f.started.promise
		const b = f.owner(
			envelope("B", () => {
				clean++
			})
		)
		await entered.promise
		f.release.resolve()
		await f.session.waitForIdle()
		expect(clean).toBe(0)
		allow.resolve()
		await Promise.all([a, b])
		expect(f.contexts).toHaveLength(3)
		expect(f.sends).toEqual([
			{ channel: "channel-a", text: "late B answer" }
		])
		expect(clean).toBe(2)
		expect(f.session.pendingMessageCount).toBe(0)
	} finally {
		allow.resolve()
		await f.close()
	}
}, 15000)

test("real SDK: handled disposition from an input extension does not create a second response", async () => {
	const f = await fixture("A answer", {
		extension: (pi) => {
			pi.on("input", (event) =>
				event.text.includes("user_message_B>")
					? { action: "handled" }
					: { action: "continue" }
			)
		}
	})
	let clean = 0
	try {
		const a = f.owner(
			envelope("A", () => {
				clean++
			})
		)
		await f.started.promise
		const b = f.owner(
			envelope("B", () => {
				clean++
			})
		)
		f.release.resolve()
		await Promise.all([a, b])
		expect(f.contexts).toHaveLength(2)
		expect(f.sends).toHaveLength(1)
		expect(clean).toBe(2)
	} finally {
		await f.close()
	}
}, 15000)

test("real SDK: one-at-a-time steering drains rapid B/C without extra final send", async () => {
	const f = await fixture("final", { mode: "one-at-a-time" })
	try {
		const a = f.owner(envelope("A", () => {}))
		await f.started.promise
		const b = f.owner(envelope("B", () => {})),
			c = f.owner(envelope("C", () => {}))
		f.release.resolve()
		await Promise.all([a, b, c])
		expect(f.contexts).toHaveLength(3)
		expect(f.sends).toHaveLength(1)
		expect(f.session.pendingMessageCount).toBe(0)
	} finally {
		await f.close()
	}
}, 15000)

test("real SDK: abort/model error fails the owner once without retrying accepted inputs", async () => {
	for (const mode of ["abort", "MODEL_ERROR"]) {
		const f = await fixture(mode)
		let clean = 0
		try {
			const a = f.owner(
				envelope("A", () => {
					clean++
				})
			)
			const error = a.catch((e) => e)
			await f.started.promise
			const b = f.owner(
				envelope("B", () => {
					clean++
				})
			)
			await Bun.sleep(5)
			const abort =
				mode === "abort" ? f.session.abort() : Promise.resolve()
			f.release.resolve()
			await abort
			const outcome = await error
			await b
			expect(outcome).toBeInstanceOf(Error)
			expect(f.sends).toHaveLength(0)
			expect(clean).toBe(2)
			expect(f.contexts.length).toBeLessThanOrEqual(2)
			expect(f.session.pendingMessageCount).toBe(0)
		} finally {
			await f.close()
		}
	}
}, 15000)

test("real SDK: automatic compaction holds new C in queue while consumed A/B settle", async () => {
	const entered = gate(),
		finish = gate(),
		events: string[] = []
	const f = await fixture("compacted final", {
		autoCompaction: true,
		extension: (pi) => {
			pi.on("session_before_compact", async (event) => {
				events.push(event.reason)
				entered.resolve()
				await finish.promise
				return {
					compaction: {
						summary: "Offline fixture summary",
						firstKeptEntryId: event.preparation.firstKeptEntryId,
						tokensBefore: event.preparation.tokensBefore
					}
				}
			})
		}
	})
	let clean = 0
	try {
		const a = f.owner(
			envelope("A", () => {
				clean++
			})
		)
		await f.started.promise
		const b = f.owner(
			envelope("B", () => {
				clean++
			})
		)
		await Bun.sleep(5)
		f.release.resolve()
		await entered.promise
		expect(f.session.isCompacting).toBe(true)
		const c = f.owner(
			envelope("C", () => {
				clean++
			})
		)
		expect(clean).toBe(0)
		finish.resolve()
		await Promise.all([a, b, c])
		expect(events.length).toBeGreaterThan(0)
		expect(
			f.session.sessionManager
				.getEntries()
				.some((e) => e.type === "compaction")
		).toBe(true)
		expect(f.sends).toHaveLength(2)
		expect(f.session.pendingMessageCount).toBe(0)
		expect(clean).toBe(3)
	} finally {
		finish.resolve()
		await f.close()
	}
}, 15000)

test("real SDK: failing auto-compaction rejects coalesced turn then clean session replacement recovers", async () => {
	const errors: string[] = []
	const f = await fixture("before compaction failure", {
		autoCompaction: true,
		extension: (pi) => {
			pi.on("session_before_compact", (event) => ({
				compaction: {
					get summary(): string {
						throw Error("Synthetic summary materialization failure")
					},
					firstKeptEntryId: event.preparation.firstKeptEntryId,
					tokensBefore: event.preparation.tokensBefore
				}
			}))
		}
	})
	const next = await fixture("replacement final")
	f.session.subscribe((event) => {
		if (event.type === "compaction_end" && event.errorMessage)
			errors.push(event.errorMessage)
	})
	let cleaned = 0
	try {
		const a = f.owner(
				envelope("A", () => {
					cleaned++
				})
			),
			outcome = a.catch((e) => e)
		await f.started.promise
		const b = f.owner(
			envelope("B", () => {
				cleaned++
			})
		)
		await Bun.sleep(5)
		f.release.resolve()
		expect(await outcome).toBeInstanceOf(Error)
		await b
		expect(errors.join()).toContain(
			"Synthetic summary materialization failure"
		)
		expect(f.sends).toHaveLength(0)
		expect(cleaned).toBe(2)
		f.replaceWith(next.session)
		next.release.resolve()
		await f.owner(
			envelope("C", () => {
				cleaned++
			})
		)
		expect(f.sends).toEqual([
			{ channel: "channel-a", text: "replacement final" }
		])
		expect(
			next.session.messages.filter((m) => m.role === "user").map(textOf)
		).toEqual([envelope("C", () => {}).text])
		expect(cleaned).toBe(3)
	} finally {
		await f.close()
		await next.close()
	}
}, 15000)

test("real SDK: transforming input is detected as uncertain, not reposted or falsely attributed", async () => {
	const f = await fixture("transformed final", {
		extension: (pi) => {
			pi.on("input", (event) =>
				event.text.includes("user_message_B>")
					? {
							action: "transform",
							text: "Synthetic transformed input"
						}
					: { action: "continue" }
			)
		}
	})
	let cleaned = 0
	try {
		const a = f.owner(
				envelope("A", () => {
					cleaned++
				})
			),
			outcome = a.catch((e) => e)
		await f.started.promise
		const b = f.owner(
			envelope("B", () => {
				cleaned++
			})
		)
		await Bun.sleep(5)
		f.release.resolve()
		expect(await outcome).toBeInstanceOf(Error)
		await b
		expect(f.sends).toHaveLength(0)
		expect(cleaned).toBe(2)
		expect(f.session.pendingMessageCount).toBe(0)
		expect(
			f.session.messages.filter((m) => m.role === "user").map(textOf)
		).toContain("Synthetic transformed input")
		await f.coordinator.beforePrompt()
	} finally {
		await f.close()
	}
}, 15000)

test("real SDK: throwing input hook follows SDK continue behavior without duplicate lifecycle", async () => {
	const f = await fixture("hook recovery final", {
		extension: (pi) => {
			pi.on("input", (event) => {
				if (event.text.includes("user_message_B>"))
					throw Error("Synthetic input hook failure")
				return { action: "continue" }
			})
		}
	})
	let clean = 0
	try {
		const a = f.owner(
			envelope("A", () => {
				clean++
			})
		)
		await f.started.promise
		const b = f.owner(
			envelope("B", () => {
				clean++
			})
		)
		await Bun.sleep(5)
		f.release.resolve()
		await Promise.all([a, b])
		expect(f.sends).toEqual([
			{ channel: "channel-a", text: "hook recovery final" }
		])
		expect(clean).toBe(2)
		expect(f.session.pendingMessageCount).toBe(0)
	} finally {
		await f.close()
	}
}, 15000)

test("real SDK: failed next-turn preparation retains actual queued B and quarantines until disposed replacement", async () => {
	const f = await fixture(),
		next = await fixture("clean new session")
	const path = join(f.dir, "retained-B.txt")
	await writeFile(path, "synthetic")
	let aClean = 0,
		bClean = 0,
		cClean = 0
	try {
		const a = f.owner(
				envelope("A", () => {
					aClean++
				})
			),
			outcome = a.catch((e) => e)
		await f.started.promise
		const b = f.owner(
			envelope("B", async () => {
				bClean++
				await rm(path)
			})
		)
		await Bun.sleep(5)
		// Public agent fault-injection hook, not a mocked AgentSession or fake queue count.
		f.session.agent.prepareNextTurnWithContext = async () => {
			throw Error("Synthetic pre-turn preparation failure")
		}
		f.release.resolve()
		expect(await outcome).toBeInstanceOf(Error)
		await b
		expect(f.session.pendingMessageCount).toBeGreaterThan(0)
		expect(aClean).toBe(1)
		expect(bClean).toBe(0)
		expect(await readFile(path, "utf8")).toBe("synthetic")
		const blocked = await f.coordinator.beforePrompt().catch((e) => e)
		expect(blocked.message).toContain("quarantined")
		const rejected = await f
			.owner(
				envelope("C", () => {
					cClean++
				})
			)
			.catch((e) => e)
		expect(rejected.message).toContain("quarantined")
		expect(cClean).toBe(1)
		f.replaceWith(next.session)
		next.release.resolve()
		await f.owner(envelope("D", () => {}))
		expect(bClean).toBe(1)
		expect(await readFile(path, "utf8").catch(() => "removed")).toBe(
			"removed"
		)
		expect(
			next.session.messages.filter((m) => m.role === "user").map(textOf)
		).toEqual([envelope("D", () => {}).text])
		expect(f.sends).toEqual([
			{ channel: "channel-a", text: "clean new session" }
		])
	} finally {
		await f.close()
		await next.close()
	}
}, 15000)
