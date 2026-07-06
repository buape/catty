import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

const configVersion = 1

const cattyDir = join(homedir(), ".catty")
const defaultConfigPath = join(cattyDir, "config.toml")
const defaultWorkspace = join(cattyDir, "workspace")
const templateConfigPath = join(import.meta.dirname, "../docs/templates/config.toml")
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
	for (let version = storedConfigVersion + 1; version <= configVersion; version++) {
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

mkdirSync(workspace, { recursive: true })
mkdirSync(join(workspace, ".pi/skills"), { recursive: true })
mkdirSync(join(workspace, ".pi/extensions"), { recursive: true })

if (!existsSync(join(workspace, "AGENTS.md"))) {
	writeFileSync(
		join(workspace, "AGENTS.md"),
		`# Workspace Instructions

Put workspace-specific rules here.
`
	)
}

if (!existsSync(join(workspace, "USER.md"))) {
	writeFileSync(
		join(workspace, "USER.md"),
		`# Primary User

Describe the primary user of this Catty workspace.
`
	)
}

if (!existsSync(join(workspace, "ME.md"))) {
	writeFileSync(
		join(workspace, "ME.md"),
		`# Agent Personality

Name the agent here, then describe how this agent should behave.
`
	)
}

if (firstLaunch) {
	console.log("Catty created first-launch files:")
	console.log(`- ${configPath}`)
	console.log(`- ${join(workspace, "AGENTS.md")}`)
	console.log(`- ${join(workspace, "USER.md")}`)
	console.log(`- ${join(workspace, "ME.md")}`)
	console.log("")
	console.log("Fill out the config and workspace Markdown files, then restart Catty.")
	process.exit(0)
}
