import { expect, test } from "bun:test"
import { createPiQueue } from "./pi-queue"

const gate = () => {
	let resolve = () => {}
	const promise = new Promise<void>((r) => {
		resolve = r
	})
	return { promise, resolve }
}
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
