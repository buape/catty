import { describe, expect, test } from "bun:test"
import { type DiscordSessionConfig, resolveDiscordSession } from "./sessions"

describe("Discord session routing", () => {
	test("existing configs keep the shared main session", () => {
		for (const pi of [undefined, {}, { channelSessions: false }]) {
			expect(resolveDiscordSession(pi, "channel", "guild")).toEqual({
				scope: "main",
				key: "main"
			})
			expect(resolveDiscordSession(pi, "dm")).toEqual({
				scope: "main",
				key: "main"
			})
		}
	})

	test("global channel sessions preserve channel IDs and isolate DMs", () => {
		const pi = { channelSessions: true }
		expect(resolveDiscordSession(pi, "123", "456")).toEqual({
			scope: "channel",
			id: "123",
			key: "channel:123"
		})
		expect(resolveDiscordSession(pi, "dm")).toEqual({
			scope: "channel",
			id: "dm",
			key: "channel:dm"
		})
	})

	for (const channelSessions of [false, true]) {
		test(`guild grouping overrides channelSessions=${channelSessions}`, () => {
			const pi: DiscordSessionConfig = {
				channelSessions,
				guilds: {
					server: { session: "guild" },
					other: { session: "guild" }
				}
			}
			const first = resolveDiscordSession(pi, "one", "server")
			expect(first).toEqual({
				scope: "guild",
				id: "server",
				key: "guild:server"
			})
			// Channels, threads, and forum posts use their supplied guild ID.
			for (const channel of ["two", "thread", "forum-post"])
				expect(resolveDiscordSession(pi, channel, "server")).toEqual(
					first
				)
			expect(resolveDiscordSession(pi, "one", "other").key).not.toBe(
				first.key
			)
			expect(resolveDiscordSession(pi, "one", "unconfigured").scope).toBe(
				channelSessions ? "channel" : "main"
			)
			expect(resolveDiscordSession(pi, "dm").scope).toBe(
				channelSessions ? "channel" : "main"
			)
		})
	}

	test("guild and channel keys cannot collide", () => {
		const pi: DiscordSessionConfig = {
			channelSessions: true,
			guilds: { same: { session: "guild" } }
		}
		expect(resolveDiscordSession(pi, "same", "same").key).not.toBe(
			resolveDiscordSession(pi, "same").key
		)
	})

	test("empty overrides inherit the global setting", () => {
		expect(
			resolveDiscordSession({ guilds: { server: {} } }, "one", "server")
				.scope
		).toBe("main")
		expect(
			resolveDiscordSession(
				{ channelSessions: true, guilds: { server: {} } },
				"one",
				"server"
			).scope
		).toBe("channel")
	})

	test("invalid explicit modes cannot silently route into main history", () => {
		const pi = {
			guilds: { server: { session: "typo" } }
		} as unknown as DiscordSessionConfig
		expect(() => resolveDiscordSession(pi, "one", "server")).toThrow(
			"Unsupported session mode"
		)
	})

	test("documented TOML override parses into the routing config", () => {
		const config = Bun.TOML.parse(
			'[pi]\nchannelSessions = true\n[pi.guilds."123"]\nsession = "guild"'
		) as { pi: DiscordSessionConfig }
		expect(resolveDiscordSession(config.pi, "456", "123").key).toBe(
			"guild:123"
		)
	})
})
