// Per-channel delivery policy and one-owner lifecycle for queued/steered chat.
export type MessageDeliveryMode = "queue" | "steer"
export type MessageDeliveryConfig = {
	default?: unknown
	channels?: Record<string, unknown>
	guilds?: Record<
		string,
		{
			default?: unknown
			channels?: Record<string, unknown>
		}
	>
}

export function resolveMessageDelivery(
	config: MessageDeliveryConfig | undefined,
	channelId: string,
	guildId?: string
): MessageDeliveryMode {
	const guild = guildId ? config?.guilds?.[guildId] : undefined
	const candidates = [
		guild?.channels?.[channelId],
		config?.channels?.[channelId],
		guild?.default,
		config?.default
	]
	for (const candidate of candidates) {
		if (candidate === undefined) continue
		// A present but invalid override must not silently inherit steer.
		return candidate === "steer" ? "steer" : "queue"
	}
	return "queue"
}

export type ActiveChatOrigin = {
	kind: "chat" | "job" | "web" | "reaction" | "component" | "command"
	channelId: string
	guildId?: string
	authorId: string
	sessionGeneration: number
	phase: "running" | "settling" | "ended"
}

export function eligibleForSteering(input: {
	mode: MessageDeliveryMode
	authorized: boolean
	responds: boolean
	channelId: string
	guildId?: string
	authorId: string
	sessionGeneration: number
	active?: ActiveChatOrigin
}): boolean {
	const active = input.active
	return (
		input.mode === "steer" &&
		input.authorized &&
		input.responds &&
		active?.kind === "chat" &&
		active.phase === "running" &&
		active.channelId === input.channelId &&
		active.guildId === input.guildId &&
		active.authorId === input.authorId &&
		active.sessionGeneration === input.sessionGeneration
	)
}

import type { AgentSession } from "@earendil-works/pi-coding-agent"

type Session = Pick<
	AgentSession,
	"prompt" | "subscribe" | "waitForIdle" | "isStreaming" | "isCompacting"
> & { pendingMessageCount?: number }
export type ChatEnvelope = {
	id: string
	channelId: string
	guildId?: string
	authorId: string
	text: string
	images?: NonNullable<Parameters<AgentSession["prompt"]>[1]>["images"]
	mode: MessageDeliveryMode
	authorized: boolean
	responds: boolean
	cleanup: () => Promise<void> | void
}
type Lease = {
	envelope: ChatEnvelope
	cleaned: boolean
	consumed: boolean
	disposition?: "handled" | "queued" | "started"
}
type Turn = {
	origin: ActiveChatOrigin
	session: Session
	leases: Lease[]
	pending: Promise<void>[]
	errors: unknown[]
	closing: boolean
	done: Promise<void>
	complete: () => void
}

// One response lifecycle owns the original message AND all reserved steering.
// A follower never subscribes to final answers, posts a final answer, or retries.
export class ChatDeliveryUncertainError extends Error {}

export class ChatDeliveryCoordinator {
	private active?: Turn
	private disposed = false
	private blockedSession?: Session
	private quarantined = new Set<Lease>()
	private leases = new Set<Lease>()
	constructor(
		private readonly runtime: {
			session: () => Session
			generation: () => number
			enqueue: (run: () => Promise<void>) => Promise<void>
			cleanupError?: (error: unknown) => void
		}
	) {}

	private async cleanup(lease: Lease, force = false) {
		if (this.quarantined.has(lease) && !force) return
		if (lease.cleaned) return
		lease.cleaned = true
		this.quarantined.delete(lease)
		this.leases.delete(lease)
		try {
			await lease.envelope.cleanup()
		} catch (error) {
			this.runtime.cleanupError?.(error)
		}
	}

	async beforePrompt() {
		if (this.disposed) throw new Error("Chat delivery is shutting down")
		if (this.blockedSession === this.runtime.session())
			throw new ChatDeliveryUncertainError(
				"Session quarantined after uncertain steering. Inspect queued input before replacing this session; no automatic replay."
			)
		if (this.blockedSession) {
			// Host session replacement disposes the old session before exposing the new one.
			await Promise.all(
				[...this.quarantined].map((lease) => this.cleanup(lease, true))
			)
			this.blockedSession = undefined
		}
	}

	async deliver(
		envelope: ChatEnvelope,
		runOwner: (settle: () => Promise<void>) => Promise<void>
	) {
		// Defense in depth: listener must have filtered BEFORE downloading/dispatch.
		if (!envelope.authorized || !envelope.responds || this.disposed) {
			await envelope.cleanup()
			return
		}
		const lease: Lease = { envelope, cleaned: false, consumed: false }
		this.leases.add(lease)
		const turn = this.active
		if (
			turn &&
			!turn.closing &&
			turn.session === this.runtime.session() &&
			turn.session.isStreaming &&
			!turn.session.isCompacting &&
			eligibleForSteering({
				...envelope,
				sessionGeneration: this.runtime.generation(),
				active: turn.origin
			})
		) {
			// Reserve synchronously, before SDK input handlers can yield. The owner
			// cannot finish/clean resources until every reserved call settles.
			turn.leases.push(lease)
			const submission = (async () => {
				try {
					await turn.session.prompt(envelope.text, {
						images: envelope.images,
						streamingBehavior: "steer",
						preflightResult: (disposition) => {
							lease.disposition = disposition
						}
					})
				} catch (error) {
					// May be partially accepted: NEVER blindly retry as a new prompt.
					turn.errors.push(error)
				}
			})()
			turn.pending.push(submission)
			await turn.done
			return // owner handles any error once; no duplicate follower error reply
		}
		try {
			await this.runtime.enqueue(async () => {
				await this.beforePrompt()
				let complete = () => {}
				const current: Turn = {
					origin: {
						kind: "chat",
						channelId: envelope.channelId,
						guildId: envelope.guildId,
						authorId: envelope.authorId,
						sessionGeneration: this.runtime.generation(),
						phase: "running"
					},
					session: this.runtime.session(),
					leases: [lease],
					pending: [],
					errors: [],
					closing: false,
					done: new Promise<void>((resolve) => {
						complete = resolve
					}),
					complete: () => complete()
				}
				this.active = current
				const unsubscribe = current.session.subscribe((event) => {
					if (
						event.type === "agent_end" ||
						event.type === "compaction_start"
					)
						current.origin.phase = "settling"
					if (
						event.type === "agent_start" &&
						!current.closing &&
						current.origin.sessionGeneration ===
							this.runtime.generation()
					)
						current.origin.phase = "running"
					if (event.type === "compaction_end" && event.errorMessage)
						current.errors.push(
							new Error("Steered chat compaction failed")
						)
					if (
						event.type === "message_end" &&
						event.message.role === "assistant" &&
						current.leases.length > 1 &&
						(event.message.stopReason === "aborted" ||
							event.message.stopReason === "error")
					)
						current.errors.push(
							new Error("Steered chat aborted or model failed")
						)
					if (
						event.type === "message_start" &&
						event.message.role === "user"
					) {
						const text =
							typeof event.message.content === "string"
								? event.message.content
								: event.message.content
										.filter((part) => part.type === "text")
										.map((part) => part.text)
										.join("")
						for (const item of current.leases)
							if (item.envelope.text === text)
								item.consumed = true
					}
				})
				const settle = async () => {
					current.closing = true
					current.origin.phase = "settling"
					await Promise.all(current.pending)
					await current.session.waitForIdle()
					if (current.session !== this.runtime.session())
						throw new ChatDeliveryUncertainError(
							"Chat session was replaced; inputs must not be replayed automatically"
						)
					if (current.errors.length)
						throw new ChatDeliveryUncertainError(
							"A steering submission failed or had an uncertain outcome; inspect before resending"
						)
					if (
						current.leases
							.slice(1)
							.some(
								(item) =>
									item.disposition !== "handled" &&
									!item.consumed
							)
					)
						throw new ChatDeliveryUncertainError(
							"Steering was not observed consumed; input was not replayed"
						)
				}
				try {
					await runOwner(settle)
				} catch (error) {
					if (current.leases.length > 1)
						throw new ChatDeliveryUncertainError(
							"Steered chat failed; delivery may be partial. Inspect before resending.",
							{ cause: error }
						)
					throw error
				} finally {
					current.closing = true
					current.origin.phase = "ended"
					// Error/abort paths still wait for in-flight SDK calls before deleting files.
					try {
						await Promise.all(current.pending)
						await current.session.waitForIdle()
					} finally {
						unsubscribe()
						if (
							(current.session.pendingMessageCount ?? 0) > 0 &&
							current.leases
								.slice(1)
								.some(
									(item) =>
										item.disposition !== "handled" &&
										!item.consumed
								)
						) {
							this.blockedSession = current.session
							for (const item of current.leases.slice(1))
								if (
									item.disposition !== "handled" &&
									!item.consumed
								)
									this.quarantined.add(item)
						}
						await Promise.all(
							current.leases.map((item) => this.cleanup(item))
						)
						if (this.active === current) this.active = undefined
						current.complete()
					}
				}
			})
		} finally {
			await this.cleanup(lease)
		}
	}

	async dispose() {
		this.disposed = true
		if (this.active) {
			this.active.closing = true
			this.active.origin.phase = "ended"
			// Await the owner, including any async SDK input preflight and final
			// postprocessing. Never delete an accepted input's files prematurely.
			await this.active.done
		}
		// Host MUST abort/wait for the session before disposal (same as shutdown).
		await Promise.all(
			[...this.leases].map((lease) => this.cleanup(lease, true))
		)
	}
}
