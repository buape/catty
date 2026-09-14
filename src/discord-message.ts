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
