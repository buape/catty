import { type Static, Type } from "typebox"
import cattyPackage from "../../package.json"
import { Tool } from "./tool"

const runtimeInfoSchema = Type.Object({})
type RuntimeInfoParams = Static<typeof runtimeInfoSchema>

class RuntimeInfoTool extends Tool<typeof runtimeInfoSchema> {
	name = "runtime_info"
	label = "Catty Runtime Info"
	description =
		"Get the running Catty version, latest GitHub release notes, and project links for releases, issues, and opening a pull request."
	parameters = runtimeInfoSchema

	protected async execute(_toolCallId: string, _params: RuntimeInfoParams) {
		let releaseInfo = "Latest release details are unavailable right now."
		try {
			const response = await fetch(
				"https://api.github.com/repos/buape/catty/releases/latest",
				{
					headers: {
						Accept: "application/vnd.github+json",
						"User-Agent": "Catty runtime-info tool"
					},
					signal: AbortSignal.timeout(8000)
				}
			)
			if (!response.ok)
				throw new Error(`GitHub API returned HTTP ${response.status}`)

			const release = (await response.json()) as {
				html_url?: string
				name?: string
				tag_name?: string
				published_at?: string
				body?: string
			}
			releaseInfo = [
				`Latest release: ${release.name || release.tag_name || "Untitled"} (${release.tag_name || "unknown version"})`,
				release.published_at
					? `Published: ${release.published_at}`
					: undefined,
				release.html_url ? `Release: ${release.html_url}` : undefined,
				release.body?.trim()
					? `Changelog:\n${release.body.trim().slice(0, 8000)}`
					: "No release notes were published."
			]
				.filter(Boolean)
				.join("\n")
		} catch (error) {
			releaseInfo += `\nGitHub lookup error: ${error instanceof Error ? error.message : String(error)}`
		}

		const text = [
			`Running Catty version: ${cattyPackage.version}`,
			releaseInfo,
			"Project: https://github.com/buape/catty",
			"Releases: https://github.com/buape/catty/releases",
			"Issues: https://github.com/buape/catty/issues",
			"Open a pull request: https://github.com/buape/catty/compare"
		].join("\n\n")

		return {
			content: [{ type: "text" as const, text }],
			details: {}
		}
	}
}

export const createRuntimeInfoTool = () => new RuntimeInfoTool().toDefinition()
