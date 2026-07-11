import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	writeFileSync
} from "node:fs"
import { homedir } from "node:os"
import { dirname, extname, join, relative, resolve } from "node:path"

const configVersion = 1

const cattyDir = join(homedir(), ".catty")
const templateConfigPath = join(
	import.meta.dirname,
	"../docs/templates/config.toml"
)
const nameArgIndex = Bun.argv.indexOf("--name")
export const agentName =
	nameArgIndex === -1 ? undefined : (Bun.argv[nameArgIndex + 1] ?? "")
if (agentName !== undefined && !/^[a-zA-Z0-9_-]+$/.test(agentName))
	throw new Error(
		"--name must contain only letters, numbers, underscores, or hyphens"
	)
const agentCattyDir = agentName ? join(cattyDir, agentName) : cattyDir
const defaultConfigPath = join(agentCattyDir, "config.toml")
const defaultWorkspace = join(agentCattyDir, "workspace")
const configArgIndex = Bun.argv.indexOf("--config")

export const configPath = resolve(
	configArgIndex === -1
		? defaultConfigPath
		: (Bun.argv[configArgIndex + 1] ?? "")
)

const firstLaunch = !existsSync(configPath)

if (firstLaunch) {
	mkdirSync(dirname(configPath), { recursive: true })
	writeFileSync(configPath, readFileSync(templateConfigPath, "utf8"))
}

let configText = readFileSync(configPath, "utf8")

const getConfigVersion = (text: string) => {
	for (const line of text.split("\n")) {
		const match = line.match(/^\s*version\s*=\s*(\d+)\s*$/)
		if (match) return Number(match[1])
	}
}

const setConfigVersion = (text: string, version: number) => {
	const lines = text.split("\n")
	for (let i = 0; i < lines.length; i++) {
		if (/^\s*version\s*=\s*\d+\s*$/.test(lines[i] ?? "")) {
			lines[i] = `version = ${version}`
			return lines.join("\n")
		}
	}
	return `${text.trimEnd()}\n\n# DO NOT CHANGE THIS VALUE\nversion = ${version}\n`
}

const migrations: Record<number, (text: string) => string> = {
	1: (text) => text
}

const storedConfigVersion = getConfigVersion(configText) ?? 0
if (storedConfigVersion > configVersion)
	throw new Error(
		`Config version ${storedConfigVersion} is newer than Catty supports (${configVersion})`
	)

if (storedConfigVersion < configVersion) {
	for (
		let version = storedConfigVersion + 1;
		version <= configVersion;
		version++
	) {
		const migrate = migrations[version]
		if (!migrate)
			throw new Error(`Missing config migration for version ${version}`)
		configText = migrate(configText)
	}
	configText = setConfigVersion(configText, configVersion)
	writeFileSync(configPath, configText)
}

export const config = Bun.TOML.parse(configText) as {
	token: string
	verbose: boolean
	pi?: {
		workspace?: string
		agentDir?: string
		provider?: string
		model?: string
		thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh"
		apiKeys?: Record<string, string>
	}
	auth?: {
		users?: string[]
		guilds?: Record<
			string,
			{
				users?: string[]
				roles?: string[]
				channels?: Record<
					string,
					{ users?: string[]; roles?: string[] }
				>
			}
		>
	}
	responses?: {
		default?: string
		prefix?: string
		channels?: Record<string, string>
	}
	heartbeat?: {
		enabled: boolean
		file?: string
		intervalMinutes?: number
		session?: "separate" | "main"
	}
}
export const workspace = resolve(
	String(config.pi?.workspace ?? defaultWorkspace).replace(
		/^~(?=$|\/)/,
		homedir()
	)
)
export const memoryPath = join(workspace, "MEMORY.qmd")
export const cattyWorkspaceDir = join(workspace, ".catty")
export const postMigrationPromptsPath = join(
	cattyWorkspaceDir,
	"post-migration-prompts.jsonl"
)

mkdirSync(workspace, { recursive: true })
mkdirSync(cattyWorkspaceDir, { recursive: true })
mkdirSync(join(workspace, "skills"), { recursive: true })
mkdirSync(join(workspace, ".pi/extensions"), { recursive: true })

if (!existsSync(join(workspace, "AGENTS.md"))) {
	writeFileSync(
		join(workspace, "AGENTS.md"),
		`# Workspace Instructions

Put workspace-specific rules here.
`
	)
}

export const queuePostMigrationPrompt = (title: string, prompt: string) => {
	writeFileSync(
		postMigrationPromptsPath,
		`${JSON.stringify({ createdAt: new Date().toISOString(), title, prompt })}\n`,
		{ flag: "a" }
	)
}

export const readPostMigrationPrompts = () => {
	if (!existsSync(postMigrationPromptsPath)) return []
	return readFileSync(postMigrationPromptsPath, "utf8")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.flatMap((line) => {
			try {
				const parsed = JSON.parse(line)
				return typeof parsed.title === "string" &&
					typeof parsed.prompt === "string"
					? [parsed]
					: []
			} catch {
				return []
			}
		})
}

export const clearPostMigrationPrompts = () => {
	if (existsSync(postMigrationPromptsPath))
		writeFileSync(postMigrationPromptsPath, "")
}

if (!existsSync(memoryPath)) {
	writeFileSync(memoryPath, "")
}

const legacyMemoryFiles = [
	[join(workspace, "USER.md"), "Primary User"],
	[join(workspace, "ME.md"), "Agent Personality"]
]
for (const entry of readdirSync(workspace, { withFileTypes: true })) {
	const path = join(workspace, entry.name)
	if (
		entry.isFile() &&
		/\.md$/i.test(entry.name) &&
		!new Set(["AGENTS.md", "MEMORY.qmd", "HEARTBEAT.md"]).has(entry.name)
	)
		legacyMemoryFiles.push([path, "Workspace Markdown"])
}
const legacyMemoryDirs = []
const seenLegacyMemoryDirs = new Set<string>()
for (const path of ["memory", "memories", "Memory", "Memories"].map((name) =>
	join(workspace, name)
)) {
	if (!existsSync(path)) continue
	const stat = lstatSync(path)
	const key = `${stat.dev}:${stat.ino}`
	if (!stat.isDirectory() || seenLegacyMemoryDirs.has(key)) continue
	seenLegacyMemoryDirs.add(key)
	legacyMemoryDirs.push(path)
}
for (const dir of legacyMemoryDirs) {
	const walk = [dir]
	for (const current of walk) {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const path = join(current, entry.name)
			if (entry.isDirectory()) walk.push(path)
			else if (/\.(md|qmd|txt)$/i.test(entry.name))
				legacyMemoryFiles.push([
					path,
					`Memory: ${relative(workspace, path)}`
				])
		}
	}
}

const migratedMemoryFiles = []
for (const [path] of legacyMemoryFiles) {
	if (!existsSync(path)) continue
	if (!lstatSync(path).isFile()) continue
	migratedMemoryFiles.push([
		path,
		join(
			workspace,
			"_migrated",
			`memory-import-${migratedMemoryFiles.length + 1}${extname(path) || ".md"}`
		)
	])
}
const movedMemoryFiles = []
for (const [path, migratedPath] of migratedMemoryFiles) {
	if (!existsSync(path)) continue
	mkdirSync(dirname(migratedPath), { recursive: true })
	let destination = migratedPath
	for (let index = 2; existsSync(destination); index++)
		destination = `${migratedPath}.${index}`
	renameSync(path, destination)
	movedMemoryFiles.push(destination)
}
if (movedMemoryFiles.length > 0)
	queuePostMigrationPrompt(
		"Organize MEMORY.qmd from migrated memory sources",
		`Catty staged source files under _migrated/ so you can organize durable memory without losing any information.

Migrated files to read:
${movedMemoryFiles.map((path) => `- ${relative(workspace, path)}`).join("\n")}

Run this post-migration cleanup in the workspace:

1. Read MEMORY.qmd and every migrated file listed above.
2. Rewrite MEMORY.qmd as the canonical durable memory file using clean sections for primary user context, agent identity/personality, preferences, and durable notes.
3. Your goal is organization only, not condensation. Do not summarize away, compress away, generalize away, or omit any information from the migrated files or existing MEMORY.qmd content.
4. Preserve every user fact, preference, personality note, durable memory, caveat, example, and detail. If you are unsure whether something matters, keep it.
5. You may remove exact duplicates, but only when the same information is truly repeated with no extra nuance.
6. Do not paste files as one big unordered dump; reorganize the content so future agents can use it directly while preserving all information.
7. Remove or update active workspace references that point future agents to durable memory sources outside MEMORY.qmd or the built-in QMD memory tool.
8. Do not edit or delete _migrated/ except to read it for context.
9. Keep edits careful and summarize what changed.`
	)

if (firstLaunch) {
	console.log("Catty created first-launch files:")
	console.log(`- ${configPath}`)
	console.log(`- ${join(workspace, "AGENTS.md")}`)
	console.log(`- ${memoryPath}`)
	console.log("")
	console.log(
		"Fill out the config, then restart Catty. Memory starts empty for now."
	)
	process.exit(0)
}
