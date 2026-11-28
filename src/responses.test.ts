import { expect, test } from "bun:test"
import { resolveResponses } from "./responses"

test("old response strings and mode objects keep eligibility; delivery defaults queue", () => {
	const responses = {
		default: "prefix",
		channels: { c: "mention-or-reply" },
		guilds: { g: { channels: { c: { mode: "all" } } } }
	}
	expect(resolveResponses(undefined, "c", "g")).toEqual({
		mode: "all",
		delivery: "queue"
	})
	expect(resolveResponses(responses, "c", "g")).toEqual({
		mode: "all",
		delivery: "queue"
	})
	expect(resolveResponses(responses, "c", "other")).toEqual({
		mode: "mention-or-reply",
		delivery: "queue"
	})
	expect(resolveResponses(responses, "other", "g")).toEqual({
		mode: "prefix",
		delivery: "queue"
	})
})

test("shared precedence independently inherits response mode and delivery", () => {
	const responses = {
		default: "prefix",
		delivery: "queue",
		channels: { c: { mode: "all", delivery: "steer" } },
		guilds: {
			g: {
				default: "mention-or-reply",
				delivery: "steer",
				channels: { c: { delivery: "queue" } }
			}
		}
	}
	expect(resolveResponses(responses, "c", "g")).toEqual({
		mode: "all",
		delivery: "queue"
	})
	expect(resolveResponses(responses, "other", "g")).toEqual({
		mode: "mention-or-reply",
		delivery: "steer"
	})
	expect(resolveResponses(responses, "c", "other")).toEqual({
		mode: "all",
		delivery: "steer"
	})
	expect(resolveResponses(responses, "other", "other")).toEqual({
		mode: "prefix",
		delivery: "queue"
	})
})

test("invalid explicit delivery fails closed without changing response eligibility", () => {
	for (const delivery of ["cancel", "STEER", null, {}, false, 1])
		expect(
			resolveResponses(
				{
					default: "all",
					delivery: "steer",
					channels: { c: { mode: "prefix", delivery } }
				},
				"c",
				"g"
			)
		).toEqual({ mode: "prefix", delivery: "queue" })
})

test("DMs retain all eligibility while allowing explicit channel delivery", () => {
	expect(resolveResponses({ default: "prefix" }, "dm")).toEqual({
		mode: "all",
		delivery: "queue"
	})
	expect(
		resolveResponses(
			{
				default: "prefix",
				channels: { dm: { mode: "prefix", delivery: "steer" } }
			},
			"dm"
		)
	).toEqual({ mode: "all", delivery: "steer" })
})
