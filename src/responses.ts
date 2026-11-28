export type ResponseScope = {
	mode?: string
	delivery?: unknown
}
export type ResponsesConfig = {
	default?: string
	prefix?: string
	delivery?: unknown
	channels?: Record<string, string | ResponseScope>
	guilds?: Record<
		string,
		{
			default?: string
			delivery?: unknown
			channels?: Record<string, string | ResponseScope>
		}
	>
}

// Resolve the existing scopes once; eligibility and delivery remain distinct.
export function resolveResponses(
	responses: ResponsesConfig | undefined,
	channelId: string,
	guildId?: string
): { mode: string; delivery: "queue" | "steer" } {
	const guild = guildId ? responses?.guilds?.[guildId] : undefined
	const scopes = [
		guild?.channels?.[channelId],
		responses?.channels?.[channelId],
		{ mode: guild?.default, delivery: guild?.delivery },
		{ mode: responses?.default, delivery: responses?.delivery }
	]
	let mode: string | undefined
	let delivery: "queue" | "steer" | undefined
	for (const value of scopes) {
		const scope = typeof value === "string" ? { mode: value } : value
		if (mode === undefined && scope?.mode !== undefined) mode = scope.mode
		if (delivery === undefined && scope?.delivery !== undefined)
			delivery = scope.delivery === "steer" ? "steer" : "queue"
	}
	return {
		mode: guildId ? (mode ?? "all") : "all",
		delivery: delivery ?? "queue"
	}
}
