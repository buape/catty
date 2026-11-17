import { expect, mock, test } from "bun:test"
import type { Client, ListenerEventData } from "@buape/carbon"
import type { AgentSession } from "@earendil-works/pi-coding-agent"
import { createReactionListeners } from "./reactions"

for (const kind of ["add", "remove"] as const) {
	for (const nestedGuild of [false, true]) {
		test(`reaction ${kind} passes ${nestedGuild ? "nested" : "raw"} guild ID to session routing`, async () => {
			const client = { clientId: "bot" } as unknown as Client
			const getPiRuntime = mock(async () => ({
				session: {
					subscribe: () => () => {}
				} as unknown as AgentSession,
				enqueuePi: async (run: () => Promise<void>) => run(),
				promptSession: async () => {}
			}))
			const listeners = createReactionListeners({
				getClient: () => client,
				getPiRuntime,
				allowedDiscordUser: async () => true
			})
			const data = {
				user: { id: "human", username: "human" },
				channel_id: "channel",
				...(nestedGuild
					? { guild: { id: "guild" } }
					: { guild_id: "guild" }),
				message_id: "message",
				emoji: { name: "👍" },
				message: { fetch: async () => ({ content: "hello" }) }
			} as unknown as ListenerEventData["MESSAGE_REACTION_ADD"]
			const listener = listeners[kind === "add" ? 0 : 1]!
			await listener.handle(data, client)
			expect(getPiRuntime).toHaveBeenCalledWith("channel", "guild")
		})
	}
}
