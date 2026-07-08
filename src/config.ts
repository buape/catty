import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"

const configVersion = 1

const cattyDir = join(homedir(), ".catty")
const defaultConfigPath = join(cattyDir, "config.toml")
const defaultWorkspace = join(cattyDir, "workspace")
const templateConfigPath = join(
	import.meta.dirname,
	"../docs/templates/config.toml"
)
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
	}
}
export const workspace = resolve(
	String(config.pi?.workspace ?? defaultWorkspace).replace(
		/^~(?=$|\/)/,
		homedir()
	)
)
export const memoryPath = join(workspace, "MEMORY.qmd")

mkdirSync(workspace, { recursive: true })
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

if (!existsSync(memoryPath)) {
	writeFileSync(
		memoryPath,
		`---
title: Catty Memory
format: gfm
---

# Catty Memory

This is Catty's canonical memory file. Keep durable user context, agent identity, preferences, and reusable notes here.

## Primary User

Describe the primary user of this Catty workspace.

## Agent Personality

Name the agent here, then describe how this agent should behave.

## Durable Notes

- Add stable preferences, facts, and recurring project context here.
`
	)
}

const legacyMemoryFiles = [
	[join(workspace, "USER.md"), "Primary User"],
	[join(workspace, "ME.md"), "Agent Personality"]
]
const legacyMemoryDirs = []
const seenLegacyMemoryDirs = new Set<string>()
for (const path of ["memory", "memories", "Memory", "Memories"].map((name) =>
	join(workspace, name)
)) {
	if (!existsSync(path)) continue
	const stat = statSync(path)
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

let memoryText = readFileSync(memoryPath, "utf8")
for (const [path, title] of legacyMemoryFiles) {
	if (!existsSync(path)) continue
	const content = readFileSync(path, "utf8").trim()
	const marker = `<!-- catty-migrated:${relative(workspace, path)} -->`
	if (!content || memoryText.includes(marker)) continue
	memoryText = `${memoryText.trimEnd()}\n\n${marker}\n\n## ${title}\n\n${content}\n`
}
writeFileSync(memoryPath, memoryText)

if (firstLaunch) {
	console.log("Catty created first-launch files:")
	console.log(`- ${configPath}`)
	console.log(`- ${join(workspace, "AGENTS.md")}`)
	console.log(`- ${memoryPath}`)
	console.log("")
	console.log(
		"Fill out the config and workspace QMD memory file, then restart Catty."
	)
	process.exit(0)
}
