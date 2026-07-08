import { existsSync, readFileSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import {
	Client,
	type ListenerEventData,
	MessageCreateListener,
	Routes
} from "@buape/carbon"
import { createServer } from "@buape/carbon/adapters/bun"
import { GatewayIntents, GatewayPlugin } from "@buape/carbon/gateway"
import {
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	defineTool,
	getAgentDir,
	ModelRegistry,
	SessionManager
} from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { config, workspace } from "./config"
import { cattySystemPrompt } from "./prompt"

export async function startCatty() {
	const agentDir = String(config.pi?.agentDir ?? getAgentDir()).replace(
		/^~(?=$|\/)/,
		homedir()
	)
	const userPath = join(workspace, "USER.md")
	const mePath = join(workspace, "ME.md")
	const heartbeatPath = join(
		workspace,
		config.heartbeat?.file ?? "HEARTBEAT.md"
	)
	const systemPrompt = [
		cattySystemPrompt,
		existsSync(userPath)
			? `\n\n# USER.md\n${readFileSync(userPath, "utf8")}`
			: "",
		existsSync(mePath) ? `\n\n# ME.md\n${readFileSync(mePath, "utf8")}` : ""
	].join("")
	console.log(`[catty] system prompt sent to pi:\n---\n${systemPrompt}\n---`)

	const authStorage = AuthStorage.create(join(agentDir, "auth.json"))

	for (const [provider, key] of Object.entries(config.pi?.apiKeys ?? {})) {
		if (typeof key === "string") authStorage.setRuntimeApiKey(provider, key)
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

	let client: Client
	const discordTool = defineTool({
		name: "discord",
		label: "Discord",
		description:
			"Fetch Discord user/guild/channel/role/member/message/webhook info, list guild channels/roles/members/events, or search messages in a channel.",
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("fetch_user"),
				Type.Literal("fetch_guild"),
				Type.Literal("fetch_channel"),
				Type.Literal("fetch_role"),
				Type.Literal("fetch_member"),
				Type.Literal("fetch_message"),
				Type.Literal("fetch_webhook"),
				Type.Literal("list_channels"),
				Type.Literal("list_roles"),
				Type.Literal("list_members"),
				Type.Literal("list_scheduled_events"),
				Type.Literal("search_messages")
			]),
			id: Type.Optional(
				Type.String({
					description: "Primary ID for user/guild/channel/webhook"
				})
			),
			guildId: Type.Optional(Type.String()),
			channelId: Type.Optional(Type.String()),
			roleId: Type.Optional(Type.String()),
			memberId: Type.Optional(Type.String()),
			messageId: Type.Optional(Type.String()),
			webhookToken: Type.Optional(Type.String()),
			query: Type.Optional(
				Type.String({ description: "Message search text" })
			),
			limit: Type.Optional(
				Type.Number({ description: "Result limit, defaults to 10" })
			),
			force: Type.Optional(Type.Boolean())
		}),
		execute: async (toolCallId, params) => {
			console.log("[discord] tool started", {
				id: toolCallId,
				action: params.action,
				idParam: params.id,
				guildId: params.guildId,
				channelId: params.channelId,
				roleId: params.roleId,
				memberId: params.memberId,
				messageId: params.messageId,
				query: params.query,
				limit: params.limit,
				force: params.force
			})
			const raw = (value: unknown): unknown => {
				if (Array.isArray(value)) return value.map(raw)
				if (value && typeof value === "object" && "rawData" in value)
					return raw((value as { rawData: unknown }).rawData)
				return value
			}
			const required = (value: string | undefined, name: string) => {
				if (!value) throw new Error(`${name} is required`)
				return value
			}

			try {
				let result: unknown
				if (params.action === "fetch_user") {
					result = await client.fetchUser(
						required(params.id, "id"),
						params.force
					)
				} else if (params.action === "fetch_guild") {
					result = await client.fetchGuild(
						required(params.id ?? params.guildId, "id or guildId"),
						params.force
					)
				} else if (params.action === "fetch_channel") {
					result = await client.fetchChannel(
						required(
							params.id ?? params.channelId,
							"id or channelId"
						),
						params.force
					)
				} else if (params.action === "fetch_role") {
					result = await client.fetchRole(
						required(params.guildId, "guildId"),
						required(params.id ?? params.roleId, "id or roleId"),
						params.force
					)
				} else if (params.action === "fetch_member") {
					result = await client.fetchMember(
						required(params.guildId, "guildId"),
						required(
							params.id ?? params.memberId,
							"id or memberId"
						),
						params.force
					)
				} else if (params.action === "fetch_message") {
					result = await client.fetchMessage(
						required(params.channelId, "channelId"),
						required(
							params.id ?? params.messageId,
							"id or messageId"
						),
						params.force
					)
				} else if (params.action === "fetch_webhook") {
					result = await client.fetchWebhook(
						params.webhookToken
							? {
									id: required(params.id, "id"),
									token: params.webhookToken
								}
							: required(params.id, "id")
					)
				} else if (params.action === "list_channels") {
					result = await (
						await client.fetchGuild(
							required(params.guildId, "guildId")
						)
					).fetchChannels()
				} else if (params.action === "list_roles") {
					result = await (
						await client.fetchGuild(
							required(params.guildId, "guildId")
						)
					).fetchRoles()
				} else if (params.action === "list_members") {
					result = await (
						await client.fetchGuild(
							required(params.guildId, "guildId")
						)
					).fetchMembers(Math.min(params.limit ?? 10, 1000))
				} else if (params.action === "list_scheduled_events") {
					result = await (
						await client.fetchGuild(
							required(params.guildId, "guildId")
						)
					).fetchScheduledEvents(true)
				} else {
					result = await (
						await client.fetchGuild(
							required(params.guildId, "guildId")
						)
					).searchMessages({
						limit: Math.min(params.limit ?? 10, 25),
						channel_id: [required(params.channelId, "channelId")],
						...(params.query ? { content: params.query } : {})
					})
				}

				const rawResult = raw(result)
				const text = JSON.stringify(rawResult, null, 2).slice(0, 20000)
				console.log("[discord] tool finished", {
					id: toolCallId,
					action: params.action,
					result: Array.isArray(rawResult)
						? `${rawResult.length} items`
						: typeof rawResult,
					bytes: text.length
				})

				return {
					content: [
						{
							type: "text",
							text
						}
					],
					details: {}
				}
			} catch (error) {
				console.error("[discord] tool error", {
					id: toolCallId,
					action: params.action,
					error
				})
				throw error
			}
		}
	})

	const { session, modelFallbackMessage } = await createAgentSession({
		cwd: workspace,
		agentDir,
		authStorage,
		modelRegistry,
		resourceLoader,
		customTools: [discordTool],
		sessionManager: SessionManager.continueRecent(workspace),
		...(model ? { model } : {}),
		...(config.pi?.thinking ? { thinkingLevel: config.pi.thinking } : {})
	})
	if (modelFallbackMessage) console.log(`[pi] ${modelFallbackMessage}`)
	console.log(`[pi] session: ${session.sessionFile ?? session.sessionId}`)

	let piQueue = Promise.resolve()

	class AssistantMessage extends MessageCreateListener {
		async handle(
			data: ListenerEventData["MESSAGE_CREATE"],
			client: Client
		) {
			if (data.author.id === client.clientId) {
				return
			}

			console.log("[discord] message received", {
				id: data.message.id,
				channelId: data.message.channelId,
				guildId: data.guild?.id ?? data.guild_id,
				authorId: data.author.id,
				author: data.author.username,
				content: data.content,
				attachments: data.rawMessage.attachments?.length ?? 0,
				referencedMessageId: data.rawMessage.referenced_message?.id
			})

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

			if (!allowed) {
				console.log(
					"[discord] ignored unauthorized message",
					data.message.id
				)
				return
			}

			const mode =
				config.responses?.channels?.[data.message.channelId] ??
				config.responses?.default ??
				"all"
			const prefix = config.responses?.prefix ?? "!catty"
			let content = data.content.trim()
			const attachments = data.rawMessage.attachments ?? []

			if (mode === "prefix") {
				if (!content.startsWith(prefix)) {
					console.log("[discord] ignored missing prefix", {
						id: data.message.id,
						prefix
					})
					return
				}
				content = content.slice(prefix.length).trim()
			}

			if (mode === "mention-or-reply") {
				const mentioned = data.rawMessage.mentions?.some(
					(user: { id: string }) => user.id === client.clientId
				)
				const replied =
					data.rawMessage.referenced_message?.author?.id ===
					client.clientId
				if (!mentioned && !replied) {
					console.log(
						"[discord] ignored not mention/reply",
						data.message.id
					)
					return
				}
				content = content
					.replace(new RegExp(`<@!?${client.clientId}>`, "g"), "")
					.trim()
			}

			if (!content && attachments.length === 0) {
				console.log("[discord] ignored empty content", data.message.id)
				return
			}

			let stopTyping = () => {}
			const startTyping = () => {
				const trigger = () =>
					client.rest
						.post(Routes.channelTyping(data.message.channelId), {})
						.catch(console.error)
				trigger()
				const interval = setInterval(trigger, 8000)
				stopTyping = () => clearInterval(interval)
			}
			startTyping()

			let attachmentTempDir: string | undefined
			const attachmentLines: string[] = []
			const images: Array<{
				type: "image"
				data: string
				mimeType: string
			}> = []

			try {
				if (attachments.length > 0) {
					attachmentTempDir = await mkdtemp(
						join(tmpdir(), "catty-attachments-")
					)
				}

				for (const [index, attachment] of attachments.entries()) {
					const filename = String(
						attachment.filename ?? `attachment-${index}`
					).replace(/[^a-zA-Z0-9._-]/g, "_")
					const filePath = join(
						attachmentTempDir ?? tmpdir(),
						`${index}-${filename}`
					)
					const response = await fetch(attachment.url)
					if (!response.ok)
						throw new Error(
							`Failed to download attachment ${filename}: HTTP ${response.status}`
						)
					const buffer = Buffer.from(await response.arrayBuffer())
					await writeFile(filePath, buffer)
					const mimeType =
						attachment.content_type ??
						response.headers.get("content-type") ??
						"application/octet-stream"

					attachmentLines.push(
						`- Filename: ${attachment.filename ?? filename}\n  Content-Type: ${mimeType}\n  Size: ${attachment.size ?? buffer.byteLength} bytes\n  Local-Path: ${filePath}`
					)
					if (mimeType.startsWith("image/")) {
						images.push({
							type: "image",
							data: buffer.toString("base64"),
							mimeType
						})
					}
				}
			} catch (error) {
				console.error("[discord] attachment download failed", error)
				stopTyping()
				if (attachmentTempDir)
					await rm(attachmentTempDir, {
						recursive: true,
						force: true
					})
				await data.message.reply(
					"Catty could not download one of the attachments. Check service logs."
				)
				return
			}

			const referenced = data.rawMessage.referenced_message
			const boundary = data.message.id
			const replyContext = referenced
				? `\nReply: ${referenced.author?.username ?? "unknown"} (${referenced.author?.id ?? "unknown"})\n<begin_untrusted_replied_message_${boundary}>\n${referenced.content?.trim() || "[no text content]"}\n<end_untrusted_replied_message_${boundary}>`
				: ""
			const attachmentContext = attachmentLines.length
				? `\nAttachments:\n${attachmentLines.join("\n")}`
				: ""
			const piPrompt = `Discord ${data.message.id} from ${data.author.username ?? "unknown"} (${data.author.id}) in ${data.message.channelId}${guildId ? ` guild ${guildId}` : ""}.${replyContext}${attachmentContext}

<begin_untrusted_user_message_${boundary}>
${content || "[no text content]"}
<end_untrusted_user_message_${boundary}>`

			console.log("[pi] prompt queued for message", data.message.id)
			console.log(`[pi] exact prompt:\n---\n${piPrompt}\n---`)

			const job = piQueue.then(async () => {
				console.log("[pi] prompt started", data.message.id)
				let text = ""
				const unsubscribe = session.subscribe((event) => {
					if (
						event.type === "message_update" &&
						event.assistantMessageEvent.type === "text_delta"
					) {
						text += event.assistantMessageEvent.delta
						return
					}
				})

				try {
					await session.prompt(
						piPrompt,
						images.length > 0 ? { images } : undefined
					)
				} finally {
					unsubscribe()
					stopTyping()
					if (attachmentTempDir)
						await rm(attachmentTempDir, {
							recursive: true,
							force: true
						})
				}

				const response =
					text.trim().slice(0, 1900) || "No text response."
				console.log("[pi] final response for message", data.message.id)
				console.log(`[pi] response:\n---\n${response}\n---`)
				if (response === "NO_REPLY") {
					console.log(
						"[discord] suppressed NO_REPLY",
						data.message.id
					)
					return
				}
				const channel = await data.message.fetchChannel()
				if (!channel?.isSendable()) {
					data.message.reply(response)
				} else {
					channel.send(response)
				}
			})

			piQueue = job.catch(() => {})
			await job.catch(async (error) => {
				console.error("[pi] error for message", data.message.id, error)
				stopTyping()
				await data.message.reply(
					"Catty hit an error. Check service logs."
				)
			})
		}
	}

	const gateway = new GatewayPlugin({
		intents:
			GatewayIntents.Guilds |
			GatewayIntents.GuildMessages |
			GatewayIntents.MessageContent
	})

	client = new Client(
		{
			baseUrl: "http://localhost",
			token: config.token,
			disableDeployRoute: true,
			runtimeProfile: "persistent"
		},
		{
			listeners: [new AssistantMessage()]
		},
		[gateway]
	)

	const server = createServer(client, { port: 3000 })

	const heartbeatInterval = setInterval(
		() => {
			if (config.heartbeat?.enabled !== true) return
			if (!existsSync(heartbeatPath)) {
				console.log("[heartbeat] skipped; HEARTBEAT.md not found")
				return
			}

			const heartbeat = readFileSync(heartbeatPath, "utf8").trim()
			if (!heartbeat) {
				console.log("[heartbeat] skipped; HEARTBEAT.md is empty")
				return
			}

			const piPrompt = `Hourly heartbeat from workspace HEARTBEAT.md. Treat this file as trusted workspace guidance.\n\n<begin_heartbeat_md>\n${heartbeat}\n<end_heartbeat_md>`
			console.log("[heartbeat] prompt queued")
			console.log(`[heartbeat] exact prompt:\n---\n${piPrompt}\n---`)

			const job = piQueue.then(async () => {
				console.log("[heartbeat] prompt started")
				let text = ""
				const unsubscribe = session.subscribe((event) => {
					if (
						event.type === "message_update" &&
						event.assistantMessageEvent.type === "text_delta"
					) {
						text += event.assistantMessageEvent.delta
						return
					}
					try {
						console.log(
							"[heartbeat] pi event",
							JSON.stringify(event)
						)
					} catch {
						console.log("[heartbeat] pi event", event.type)
					}
				})

				try {
					await session.prompt(piPrompt)
				} finally {
					unsubscribe()
				}

				console.log(
					"[heartbeat] final response:\n---\n" +
						(text.trim() || "No text response.") +
						"\n---"
				)
			})

			piQueue = job.catch(() => {})
			job.catch((error) => console.error("[heartbeat] error", error))
		},
		(config.heartbeat?.intervalMinutes ?? 60) * 60 * 1000
	)

	console.log("Catty running at http://localhost")
	console.log(`Workspace: ${workspace}`)
	console.log(`Heartbeat: ${heartbeatPath}`)

	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.on(signal, () => {
			clearInterval(heartbeatInterval)
			gateway.disconnect()
			session.dispose()
			server.stop()
			process.exit(0)
		})
	}
}
