import { describe, expect, test } from "bun:test"
import {
	type ActiveChatOrigin,
	eligibleForSteering,
	resolveMessageDelivery
} from "./message-delivery"

describe("local-only delivery policy prototype", () => {
	test("old configs and DMs remain queued", () => {
		expect(resolveMessageDelivery(undefined, "dm")).toBe("queue")
		expect(resolveMessageDelivery({}, "channel", "guild")).toBe("queue")
	})
	test("explicit channel mode does not spread to another shared-session channel", () => {
		const config = { channels: { a: "steer" } }
		expect(resolveMessageDelivery(config, "a", "guild")).toBe("steer")
		expect(resolveMessageDelivery(config, "b", "guild")).toBe("queue")
	})
	test("guild-channel override wins, followed by channel, guild and default", () => {
		const config = {
			default: "steer",
			channels: { a: "steer" },
			guilds: { g: { default: "queue", channels: { a: "queue" } } }
		}
		expect(resolveMessageDelivery(config, "a", "g")).toBe("queue")
		expect(resolveMessageDelivery(config, "a", "other")).toBe("steer")
		expect(resolveMessageDelivery(config, "b", "g")).toBe("queue")
		expect(resolveMessageDelivery(config, "b", "other")).toBe("steer")
	})
	test("invalid explicit overrides fail closed instead of inheriting steer", () => {
		for (const invalid of ["interrupt", "STEER", "", null, true, 1, {}]) {
			expect(
				resolveMessageDelivery(
					{ default: "steer", channels: { a: invalid } },
					"a"
				)
			).toBe("queue")
		}
	})
	const active: ActiveChatOrigin = {
		kind: "chat",
		channelId: "a",
		guildId: "g",
		authorId: "owner",
		sessionGeneration: 4,
		phase: "running"
	}
	const input = {
		mode: "steer" as const,
		authorized: true,
		responds: true,
		channelId: "a",
		guildId: "g",
		authorId: "owner",
		sessionGeneration: 4,
		active
	}
	test("same-origin authorized active chat is eligible", () => {
		expect(eligibleForSteering(input)).toBe(true)
	})
	test("authentication and response filtering cannot be bypassed", () => {
		expect(eligibleForSteering({ ...input, authorized: false })).toBe(false)
		expect(eligibleForSteering({ ...input, responds: false })).toBe(false)
		expect(eligibleForSteering({ ...input, mode: "queue" })).toBe(false)
	})
	test("other channels, guilds, authors and DMs cannot hijack a chat", () => {
		expect(eligibleForSteering({ ...input, channelId: "b" })).toBe(false)
		expect(eligibleForSteering({ ...input, guildId: "other" })).toBe(false)
		expect(eligibleForSteering({ ...input, guildId: undefined })).toBe(
			false
		)
		expect(eligibleForSteering({ ...input, authorId: "peer" })).toBe(false)
	})
	test("jobs, web, reactions and components are not chat steering destinations", () => {
		for (const kind of ["job", "web", "reaction", "component"] as const) {
			expect(
				eligibleForSteering({ ...input, active: { ...active, kind } })
			).toBe(false)
		}
	})
	test("idle, settling, ended and replaced sessions are not eligible", () => {
		expect(eligibleForSteering({ ...input, active: undefined })).toBe(false)
		expect(
			eligibleForSteering({
				...input,
				active: { ...active, phase: "settling" }
			})
		).toBe(false)
		expect(
			eligibleForSteering({
				...input,
				active: { ...active, phase: "ended" }
			})
		).toBe(false)
		expect(eligibleForSteering({ ...input, sessionGeneration: 5 })).toBe(
			false
		)
	})
})

test("explicit DM override, invalid guild override and command origin remain conservative", () => {
	expect(resolveMessageDelivery({ channels: { dm: "steer" } }, "dm")).toBe(
		"steer"
	)
	expect(
		resolveMessageDelivery(
			{ default: "steer", guilds: { g: { default: "invalid" } } },
			"x",
			"g"
		)
	).toBe("queue")
	expect(
		eligibleForSteering({
			mode: "steer",
			authorized: true,
			responds: true,
			channelId: "a",
			authorId: "owner",
			sessionGeneration: 0,
			active: {
				kind: "command",
				channelId: "a",
				authorId: "owner",
				sessionGeneration: 0,
				phase: "running"
			}
		})
	).toBe(false)
})
