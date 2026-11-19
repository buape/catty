import {
	type BaseComponentInteraction,
	MessageFlags,
	type ModalInteraction,
	Routes
} from "@buape/carbon"

export const splitDiscordContent = (content: string, limit = 1900) => {
	const chunks: string[] = []
	let remaining = content.trim()

	while (remaining.length > limit) {
		let index = remaining.lastIndexOf("\n", limit)
		if (index < limit * 0.6) index = remaining.lastIndexOf(" ", limit)
		if (index < limit * 0.6) index = limit
		chunks.push(remaining.slice(0, index).trimEnd())
		remaining = remaining.slice(index).trimStart()
	}

	if (remaining) chunks.push(remaining)
	return chunks.length > 0 ? chunks : ["No text response."]
}

export const extractDiscordComponentResponse = (text: string) => {
	const match = text.match(
		/```(?:catty-discord-components-v2|discord-components-v2|cv2)\s*\n([\s\S]*?)\n```|<discord-components-v2>([\s\S]*?)<\/discord-components-v2>/i
	)
	if (!match) return
	const raw = match[1] ?? match[2]
	if (!raw) return
	const payload = JSON.parse(raw) as Record<string, unknown>
	if (!Array.isArray(payload.components))
		throw new Error(
			"Discord component response must include a components array"
		)
	const leadingText = text.replace(match[0], "").trim()
	const components = [...payload.components]
	if (leadingText) components.unshift({ type: 10, content: leadingText })
	const body = {
		...payload,
		components,
		flags:
			(typeof payload.flags === "number" ? payload.flags : 0) |
			MessageFlags.IsComponentsV2
	}
	return { body }
}

// Carbon reply() edits @original after defer(); raw CV2 JSON bypasses its
// component-class serializer, just like the channel response path.
export const replyToDeferredComponentInteraction = async (
	interaction: BaseComponentInteraction | ModalInteraction,
	text: string
) => {
	const response = text.trim() || "No text response."
	const original = Routes.webhookMessage(
		interaction.rawData.application_id,
		interaction.rawData.token,
		"@original"
	)
	if (response === "NO_REPLY") {
		await interaction.client.rest.delete(original)
		return
	}
	const extracted = extractDiscordComponentResponse(response)
	if (extracted) {
		await interaction.client.rest.patch(original, { body: extracted.body })
		return
	}
	const [first, ...remaining] = splitDiscordContent(response)
	await interaction.reply(first)
	for (const chunk of remaining) await interaction.followUp(chunk)
}
