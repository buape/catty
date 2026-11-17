export type DiscordSessionConfig = {
	channelSessions?: boolean
	guilds?: Record<string, { session?: "guild" }>
}

// Guild overrides win before the global channel-session default is consulted.
export function resolveDiscordSession(
	pi: DiscordSessionConfig | undefined,
	channelId: string,
	guildId?: string
) {
	const mode = guildId ? pi?.guilds?.[guildId]?.session : undefined
	if (mode !== undefined && mode !== "guild")
		throw new Error(
			`Unsupported session mode for guild ${guildId}: ${mode}`
		)
	if (guildId && mode === "guild")
		return { scope: "guild", id: guildId, key: `guild:${guildId}` } as const
	if (pi?.channelSessions === true)
		return {
			scope: "channel",
			id: channelId,
			key: `channel:${channelId}`
		} as const
	return { scope: "main", key: "main" } as const
}
