import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

const cattyDir = join(homedir(), ".catty")
const defaultConfigPath = join(cattyDir, "config.toml")
const defaultWorkspace = join(cattyDir, "workspace")
const configArgIndex = Bun.argv.indexOf("--config")

export const configPath = resolve(
	configArgIndex === -1
		? defaultConfigPath
		: (Bun.argv[configArgIndex + 1] ?? "")
)

if (!existsSync(configPath)) {
	mkdirSync(dirname(configPath), { recursive: true })
	writeFileSync(
		configPath,
		`# Catty config. Fill in the required Discord values, then restart Catty.
# Full config reference: https://github.com/thewilloftheshadow/catty/blob/main/docs/config.md

[discord]
baseUrl = "http://localhost:3000"
clientId = "your-discord-application-id"
publicKey = "your-discord-public-key"
token = "your-discord-bot-token"
`
	)
}

export const config = Bun.TOML.parse(readFileSync(configPath, "utf8")) as {
	discord: {
		baseUrl: string
		clientId: string
		publicKey: string | string[]
		token: string
		deploySecret?: string
		port?: number
		totalShards?: number
	}
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
