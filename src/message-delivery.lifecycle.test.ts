import { expect, test } from "bun:test"
import type { AgentSession } from "@earendil-works/pi-coding-agent"
import {
	ChatDeliveryCoordinator,
	ChatDeliveryUncertainError,
	type ChatEnvelope
} from "./message-delivery"
import { createPiQueue } from "./pi-queue"

const gate = () => {
	let resolve = () => {}
	const promise = new Promise<void>((r) => {
		resolve = r
	})
	return { promise, resolve }
}
const input = (
	id: string,
	cleanup = () => {},
	extra: Partial<ChatEnvelope> = {}
): ChatEnvelope => ({
	id,
	channelId: "a",
	guildId: "g",
	authorId: "owner",
	text: id,
	mode: "steer",
	authorized: true,
	responds: true,
	cleanup,
	...extra
})
function mockSession() {
	const listeners = new Set<Parameters<AgentSession["subscribe"]>[0]>()
	const session = {
		isStreaming: true,
		isCompacting: false,
		prompt: async (
			_text: string,
			_options?: Parameters<AgentSession["prompt"]>[1]
		) => {},
		subscribe: (fn: Parameters<AgentSession["subscribe"]>[0]) => {
			listeners.add(fn)
			return () => {
				listeners.delete(fn)
			}
		},
		waitForIdle: async () => {}
	}
	const consume = (text: string) => {
		for (const f of listeners)
			f({
				type: "message_start",
				message: {
					role: "user",
					content: [{ type: "text", text }],
					timestamp: 0
				}
			})
	}
	return { session, consume, listeners }
}

test("race model: in-flight B can finish after A; single owner waits and never queues B twice", async () => {
	const { session, consume, listeners } = mockSession(),
		aStarted = gate(),
		aDone = gate(),
		inputGate = gate()
	const clean: string[] = [],
		sends: string[] = []
	let submissions = 0
	session.prompt = async (text, options) => {
		submissions++
		await inputGate.promise
		options?.preflightResult?.("started")
		consume(text)
	}
	const c = new ChatDeliveryCoordinator({
		session: () => session,
		generation: () => 0,
		enqueue: createPiQueue()
	})
	const a = c.deliver(
		input("A", () => {
			clean.push("A")
		}),
		async (settle) => {
			aStarted.resolve()
			await aDone.promise
			await settle()
			sends.push("one")
		}
	)
	await aStarted.promise
	const b = c.deliver(
		input("B", () => {
			clean.push("B")
		}),
		async () => {
			throw Error("must not execute follower owner")
		}
	)
	aDone.resolve()
	await Bun.sleep(1)
	expect(clean).toEqual([])
	expect(sends).toEqual([])
	inputGate.resolve()
	await Promise.all([a, b])
	expect(submissions).toBe(1)
	expect(sends).toEqual(["one"])
	expect(clean.sort()).toEqual(["A", "B"])
	expect(listeners.size).toBe(0)
})

test("handled input releases once without a phantom second final answer", async () => {
	const { session } = mockSession(),
		started = gate(),
		release = gate()
	let clean = 0,
		send = 0
	session.prompt = async (_text, options) => {
		options?.preflightResult?.("handled")
	}
	const c = new ChatDeliveryCoordinator({
		session: () => session,
		generation: () => 0,
		enqueue: createPiQueue()
	})
	const a = c.deliver(
		input("A", () => {
			clean++
		}),
		async (settle) => {
			started.resolve()
			await release.promise
			await settle()
			send++
		}
	)
	await started.promise
	const b = c.deliver(
		input("B", () => {
			clean++
		}),
		async () => {
			send++
		}
	)
	release.resolve()
	await Promise.all([a, b])
	expect(clean).toBe(2)
	expect(send).toBe(1)
})

test("accepted but stranded or ambiguous input fails closed; no retry and only owner fails", async () => {
	for (const ambiguous of [false, true]) {
		const { session, listeners } = mockSession(),
			started = gate(),
			release = gate()
		let calls = 0,
			clean = 0
		session.prompt = async (_text, options) => {
			calls++
			if (ambiguous) throw Error("uncertain after SDK hook")
			options?.preflightResult?.("queued")
		}
		const c = new ChatDeliveryCoordinator({
			session: () => session,
			generation: () => 0,
			enqueue: createPiQueue()
		})
		const a = c.deliver(
			input("A", () => {
				clean++
			}),
			async (settle) => {
				started.resolve()
				await release.promise
				await settle()
			}
		)
		const caught = a.then(
			() => null,
			(error) => error
		)
		await started.promise
		const b = c.deliver(
			input("B", () => {
				clean++
			}),
			async () => {
				throw Error("blind retry")
			}
		)
		release.resolve()
		expect(await caught).toBeInstanceOf(ChatDeliveryUncertainError)
		await b
		expect(calls).toBe(1)
		expect(clean).toBe(2)
		expect(listeners.size).toBe(0)
	}
})

test("session replacement, settling and non-chat queued work never receive accidental steering", async () => {
	const { session } = mockSession(),
		other = mockSession().session,
		started = gate(),
		release = gate()
	let current = session,
		calls = 0
	session.prompt = async () => {
		calls++
	}
	const q = createPiQueue(),
		c = new ChatDeliveryCoordinator({
			session: () => current,
			generation: () => 0,
			enqueue: q
		})
	const background = q(async () => {
		started.resolve()
		await release.promise
	})
	await started.promise
	const a = c.deliver(input("A"), async (settle) => {
		expect(calls).toBe(0)
		await settle()
	})
	const b = c.deliver(input("B"), async (settle) => {
		expect(calls).toBe(0)
		await settle()
	})
	release.resolve()
	await Promise.all([background, a, b])
	expect(calls).toBe(0)
	// A shared session object swap invalidates an active owner, even without a counter change.
	const start = gate(),
		end = gate()
	const x = c.deliver(input("X"), async (settle) => {
		start.resolve()
		await end.promise
		await settle()
	})
	const caught = x.then(
		() => null,
		(error) => error
	)
	await start.promise
	current = other
	end.resolve()
	expect((await caught)?.message).toContain("replaced")
})

test("original queue preserves normal FIFO ahead of low-priority work; failed jobs do not poison queue", async () => {
	const q = createPiQueue(),
		started = gate(),
		release = gate(),
		order: string[] = []
	const first = q(async () => {
		started.resolve()
		await release.promise
		order.push("running")
	})
	await started.promise
	const low = q(
		async () => {
			order.push("low")
		},
		{ lowPriority: true }
	)
	const a = q(async () => {
		order.push("A")
	})
	const failed = q(async () => {
		order.push("failure")
		throw Error("fixture")
	})
	const failure = failed.catch((error) => error)
	const b = q(async () => {
		order.push("B")
	})
	release.resolve()
	await Promise.all([first, low, a, b, failure])
	expect(order).toEqual(["running", "A", "failure", "B", "low"])
})

test("shutdown after session abort cleans a queued attachment once; no queued owner execution", async () => {
	const { session } = mockSession(),
		started = gate(),
		release = gate()
	let clean = 0,
		ran = 0
	const q = createPiQueue(),
		background = q(async () => {
			started.resolve()
			await release.promise
		})
	await started.promise
	const c = new ChatDeliveryCoordinator({
		session: () => session,
		generation: () => 0,
		enqueue: q
	})
	const job = c.deliver(
		input("A", () => {
			clean++
		}),
		async () => {
			ran++
		}
	)
	const rejected = job.then(
		() => null,
		(error) => error
	)
	await c.dispose()
	expect(clean).toBe(1)
	release.resolve()
	await Promise.all([background, rejected])
	expect((await rejected)?.message).toContain("shutting down")
	expect(ran).toBe(0)
	expect(clean).toBe(1)
})

test("residual SDK queue is quarantined, files retained and later prompts blocked until safe replacement/disposal", async () => {
	const base = mockSession(),
		session = Object.assign(base.session, { pendingMessageCount: 1 }),
		started = gate(),
		release = gate()
	let clean = 0
	session.prompt = async (_text, options) => {
		options?.preflightResult?.("queued")
	}
	const c = new ChatDeliveryCoordinator({
		session: () => session,
		generation: () => 0,
		enqueue: createPiQueue()
	})
	const a = c.deliver(
			input("A", () => {
				clean++
			}),
			async (settle) => {
				started.resolve()
				await release.promise
				await settle()
			}
		),
		caught = a.catch((error) => error)
	await started.promise
	const b = c.deliver(
		input("B", () => {
			clean++
		}),
		async () => {
			throw Error("must not run")
		}
	)
	release.resolve()
	expect(await caught).toBeInstanceOf(ChatDeliveryUncertainError)
	await b
	expect(clean).toBe(1) // A released; B belongs to a still-pending SDK input.
	const blocked = await c.beforePrompt().catch((error) => error)
	expect(blocked.message).toContain("quarantined")
	const later = await c
		.deliver(
			input("C", () => {
				clean++
			}),
			async () => {
				throw Error("must not run")
			}
		)
		.catch((error) => error)
	expect(later.message).toContain("quarantined")
	expect(clean).toBe(2)
	// Host has aborted/waited for session and is now disposing it, not replaying B.
	await c.dispose()
	expect(clean).toBe(3)
})
