import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import {
	Client,
	type ListenerEventData,
	MessageCreateListener
} from "@buape/carbon"
import { createServer } from "@buape/carbon/adapters/bun"
import { GatewayIntents, ShardingPlugin } from "@buape/carbon/sharding"
import {
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	ModelRegistry,
	SessionManager
} from "@earendil-works/pi-coding-agent"
import { config, workspace } from "./config"
import { cattySystemPrompt } from "./prompt"

const agentDir = String(config.pi?.agentDir ?? getAgentDir()).replace(
	/^~(?=$|\/)/,
	homedir()
)
const userPath = join(workspace, "USER.md")
const mePath = join(workspace, "ME.md")
const systemPrompt = [
	cattySystemPrompt,
	existsSync(userPath)
		? `\n\n# USER.md\n${readFileSync(userPath, "utf8")}`
		: "",
	existsSync(mePath) ? `\n\n# ME.md\n${readFileSync(mePath, "utf8")}` : ""
].join("")
const authStorage = AuthStorage.create(join(agentDir, "auth.json"))

for (const [provider, key] of Object.entries(config.pi?.apiKeys ?? {})) {
	if (typeof key === "string") authStorage.setRuntimeApiKey(provider, key)
}

if (Bun.argv[2] === "auth" && Bun.argv[3] === "login") {
	const provider = Bun.argv[4] ?? "openai-codex"
	if (provider !== "openai-codex")
		throw new Error(
			`Only openai-codex OAuth is wired right now: ${provider}`
		)
	await authStorage.login(provider, {
		onSelect: async () => "device_code",
		onDeviceCode: (info) => {
			console.log(`Open ${info.verificationUri}`)
			console.log(`Enter code: ${info.userCode}`)
			console.log("Waiting for login to finish...")
		},
		onAuth: (info) => {
			console.log(info.instructions ?? "Open this URL to continue:")
			console.log(info.url)
		},
		onPrompt: async (prompt) => {
			console.log(prompt.message)
			for await (const chunk of Bun.stdin.stream())
				return new TextDecoder().decode(chunk).trim()
			return ""
		},
		onProgress: (message) => console.log(message)
	})
	console.log(`Logged in: ${provider}`)
	process.exit(0)
}

const modelRegistry = ModelRegistry.create(
	authStorage,
	join(agentDir, "models.json")
)
const model =
	config.pi?.provider && config.pi?.model
		? modelRegistry.find(config.pi.provider, config.pi.model)
		: undefined
if (config.pi?.provider && config.pi?.model && !model)
	throw new Error(
		`Unknown pi model: ${config.pi.provider}/${config.pi.model}`
	)

const resourceLoader = new DefaultResourceLoader({
	cwd: workspace,
	agentDir,
	systemPromptOverride: () => systemPrompt,
	appendSystemPromptOverride: () => []
})
await resourceLoader.reload()

const { session } = await createAgentSession({
	cwd: workspace,
	agentDir,
	authStorage,
	modelRegistry,
	resourceLoader,
	sessionManager: SessionManager.create(workspace),
	...(model ? { model } : {}),
	...(config.pi?.thinking ? { thinkingLevel: config.pi.thinking } : {})
})

let piQueue = Promise.resolve()

class AssistantMessage extends MessageCreateListener {
	async handle(data: ListenerEventData[this["type"]], client: Client) {
		if (data.author.id === client.options.clientId) return

		const auth = config.auth ?? {}
		const guildId = data.guild?.id ?? data.guild_id
		const roleIds = data.rawMember?.roles ?? []
		let allowed = true

		if (!guildId) {
			allowed =
				auth.users === undefined
					? true
					: auth.users.includes(data.author.id)
		} else if (auth.guilds !== undefined) {
			const guild = auth.guilds[guildId]
			const channel =
				guild?.channels === undefined
					? undefined
					: guild.channels[data.message.channelId]
			const guildPrincipalAllowed = guild
				? guild.users === undefined && guild.roles === undefined
					? true
					: (guild.users?.includes(data.author.id) ?? false) ||
						(guild.roles?.some((role: string) =>
							roleIds.includes(role)
						) ??
							false)
				: false
			const channelPrincipalAllowed = channel
				? channel.users === undefined && channel.roles === undefined
					? true
					: (channel.users?.includes(data.author.id) ?? false) ||
						(channel.roles?.some((role: string) =>
							roleIds.includes(role)
						) ??
							false)
				: guild?.channels === undefined
			allowed =
				Boolean(guild) &&
				guildPrincipalAllowed &&
				channelPrincipalAllowed
		}

		if (!allowed) return

		const mode =
			config.responses?.channels?.[data.message.channelId] ??
			config.responses?.default ??
			"all"
		const prefix = config.responses?.prefix ?? "!catty"
		let content = data.content.trim()

		if (mode === "prefix") {
			if (!content.startsWith(prefix)) return
			content = content.slice(prefix.length).trim()
		}

		if (mode === "mention-or-reply") {
			const mentioned = data.rawMessage.mentions?.some(
				(user: { id: string }) => user.id === client.options.clientId
			)
			const replied =
				data.rawMessage.referenced_message?.author?.id ===
				client.options.clientId
			if (!mentioned && !replied) return
			content = content
				.replace(new RegExp(`<@!?${client.options.clientId}>`, "g"), "")
				.trim()
		}

		if (!content) return

		const status = await data.message.reply("Thinking…")
		const job = piQueue.then(async () => {
			let text = ""
			const unsubscribe = session.subscribe((event) => {
				if (
					event.type === "message_update" &&
					event.assistantMessageEvent.type === "text_delta"
				) {
					text += event.assistantMessageEvent.delta
				}
			})

			try {
				await session.prompt(
					`Discord message from ${data.author.username ?? data.author.id} in channel ${data.message.channelId}${guildId ? ` guild ${guildId}` : ""}:\n\n${content}`
				)
			} finally {
				unsubscribe()
			}

			await status.edit(text.trim().slice(0, 1900) || "No text response.")
		})

		piQueue = job.catch(() => {})
		await job.catch(async (error) => {
			console.error(error)
			await status.edit("Catty hit an error. Check service logs.")
		})
	}
}

const sharding = new ShardingPlugin({
	totalShards: config.discord?.totalShards ?? 1,
	intents:
		GatewayIntents.Guilds |
		GatewayIntents.GuildMessages |
		GatewayIntents.MessageContent
})

const client = new Client(
	{
		baseUrl: config.discord.baseUrl,
		clientId: config.discord.clientId,
		publicKey: config.discord.publicKey,
		token: config.discord.token,
		deploySecret: config.discord.deploySecret,
		disableDeployRoute: !config.discord.deploySecret,
		runtimeProfile: "persistent"
	},
	{
		listeners: [new AssistantMessage()]
	},
	[sharding]
)

const server = createServer(client, { port: config.discord?.port ?? 3000 })

console.log(`Catty running at ${config.discord.baseUrl}`)
console.log(`Workspace: ${workspace}`)

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		sharding.disconnect()
		session.dispose()
		server.stop()
		process.exit(0)
	})
}
