import type { AgentSession } from "@earendil-works/pi-coding-agent"

export type ChatEnvelope = {
	channelId: string
	guildId?: string
	authorId: string
	text: string
	images?: NonNullable<Parameters<AgentSession["prompt"]>[1]>["images"]
	mode: "queue" | "steer"
	authorized: boolean
	responds: boolean
	cleanup: () => Promise<void> | void
}

type Session = Pick<
	AgentSession,
	| "prompt"
	| "waitForIdle"
	| "isStreaming"
	| "isCompacting"
	| "pendingMessageCount"
	| "clearQueue"
>
export type ActiveChat = {
	session: Session
	origin: Pick<ChatEnvelope, "channelId" | "guildId" | "authorId">
	submissions: Promise<PromiseSettledResult<void>>[]
	cleanups: ChatEnvelope["cleanup"][]
}

export class UnprocessedInputError extends Error {
	constructor(
		readonly count: number,
		options?: ErrorOptions
	) {
		super(
			`${count} pending SDK input(s) were not processed and have been removed. Resend needed messages from their original sources; nothing was replayed.`,
			options
		)
	}
}

// Pi owns execution, input transforms, compaction and aborts. Catty only owns
// admission to a chat and resources that must survive through its final send.
export class ChatSteering {
	private active?: ActiveChat

	open(session: Session, origin: ChatEnvelope): ActiveChat {
		const chat: ActiveChat = {
			session,
			origin,
			submissions: [],
			cleanups: [origin.cleanup]
		}
		this.active = chat
		return chat
	}

	steer(session: Session, input: ChatEnvelope): boolean {
		const chat = this.active
		if (
			!chat ||
			chat.session !== session ||
			input.mode !== "steer" ||
			!input.authorized ||
			!input.responds ||
			!session.isStreaming ||
			session.isCompacting ||
			chat.origin.channelId !== input.channelId ||
			chat.origin.guildId !== input.guildId ||
			chat.origin.authorId !== input.authorId
		)
			return false

		// Reserve before async SDK preflight. Rejections are observed immediately;
		// the owner reports them once, without retrying or a follower final reply.
		chat.cleanups.push(input.cleanup)
		chat.submissions.push(
			session
				.prompt(input.text, {
					images: input.images,
					streamingBehavior: "steer"
				})
				.then(
					() => ({ status: "fulfilled", value: undefined }),
					(reason: unknown) => ({ status: "rejected", reason })
				)
		)
		return true
	}

	closeAdmission() {
		this.active = undefined
	}

	// Called ONCE by the prompt owner, before host session replacement or final
	// response processing. A late preflight can start a supported continuation.
	async settle(chat: ActiveChat) {
		if (this.active === chat) this.closeAdmission()
		const results = await Promise.all(chat.submissions)
		await chat.session.waitForIdle()
		const errors = results
			.filter((r) => r.status === "rejected")
			.map((r) => r.reason)
		const cause = errors.length
			? new AggregateError(errors, "Steering input submission failed")
			: undefined
		if (chat.session.pendingMessageCount > 0) {
			// Public SDK recovery contract, only after accepted preflights and runs
			// settle. Never touch Catty's external queue or replay pending text.
			const pending = chat.session.clearQueue()
			throw new UnprocessedInputError(
				pending.steering.length + pending.followUp.length,
				{ cause }
			)
		}
		if (cause) throw cause
	}
}
