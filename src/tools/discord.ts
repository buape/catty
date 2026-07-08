import type { Client } from "@buape/carbon"
import { type Static, Type } from "typebox"
import { Tool } from "./tool"

const commonSchema = Type.Object({
	force: Type.Optional(Type.Boolean()),
	limit: Type.Optional(
		Type.Number({ description: "Result limit, defaults to 10" })
	),
	query: Type.Optional(Type.String({ description: "Message search text" })),
	webhookToken: Type.Optional(Type.String()),
	id: Type.Optional(Type.String({ description: "Discord snowflake ID" })),
	guildId: Type.Optional(Type.String()),
	channelId: Type.Optional(Type.String()),
	roleId: Type.Optional(Type.String()),
	memberId: Type.Optional(Type.String()),
	messageId: Type.Optional(Type.String())
})

const discordSchema = Type.Union([
	Type.Intersect([
		commonSchema,
		Type.Object({
			action: Type.Literal("fetch_user"),
			id: Type.String({ description: "User ID" })
		})
	]),
	Type.Intersect([
		commonSchema,
		Type.Object({
			action: Type.Literal("fetch_guild"),
			id: Type.String({ description: "Guild ID" })
		})
	]),
	Type.Intersect([
		commonSchema,
		Type.Object({
			action: Type.Literal("fetch_channel"),
			id: Type.String({ description: "Channel ID" })
		})
	]),
	Type.Intersect([
		commonSchema,
		Type.Object({
			action: Type.Literal("fetch_role"),
			guildId: Type.String(),
			id: Type.String({ description: "Role ID" })
		})
	]),
	Type.Intersect([
		commonSchema,
		Type.Object({
			action: Type.Literal("fetch_member"),
			guildId: Type.String(),
			id: Type.String({ description: "User/member ID" })
		})
	]),
	Type.Intersect([
		commonSchema,
		Type.Object({
			action: Type.Literal("fetch_message"),
			channelId: Type.String(),
			id: Type.String({ description: "Message ID" })
		})
	]),
	Type.Intersect([
		commonSchema,
		Type.Object({
			action: Type.Literal("fetch_webhook"),
			id: Type.String({ description: "Webhook ID or URL" })
		})
	]),
	Type.Intersect([
		commonSchema,
		Type.Object({
			action: Type.Literal("list_channels"),
			guildId: Type.String()
		})
	]),
	Type.Intersect([
		commonSchema,
		Type.Object({
			action: Type.Literal("list_roles"),
			guildId: Type.String()
		})
	]),
	Type.Intersect([
		commonSchema,
		Type.Object({
			action: Type.Literal("list_members"),
			guildId: Type.String()
		})
	]),
	Type.Intersect([
		commonSchema,
		Type.Object({
			action: Type.Literal("list_scheduled_events"),
			guildId: Type.String()
		})
	]),
	Type.Intersect([
		commonSchema,
		Type.Object({
			action: Type.Literal("search_messages"),
			guildId: Type.String(),
			channelId: Type.String()
		})
	])
])

type DiscordParams = Static<typeof discordSchema>

abstract class DiscordAction {
	constructor(
		protected client: Client,
		protected params: DiscordParams
	) {}

	abstract execute(): Promise<unknown>

	protected required(value: string | undefined, name: string) {
		if (!value) throw new Error(`${name} is required`)
		return value
	}

	protected fetchGuild() {
		return this.client.fetchGuild(
			this.required(this.params.guildId, "guildId")
		)
	}
}

class FetchUserAction extends DiscordAction {
	execute() {
		return this.client.fetchUser(
			this.required(this.params.id, "id"),
			this.params.force
		)
	}
}

class FetchGuildAction extends DiscordAction {
	execute() {
		return this.client.fetchGuild(
			this.required(
				this.params.id ?? this.params.guildId,
				"id or guildId"
			),
			this.params.force
		)
	}
}

class FetchChannelAction extends DiscordAction {
	execute() {
		return this.client.fetchChannel(
			this.required(
				this.params.id ?? this.params.channelId,
				"id or channelId"
			),
			this.params.force
		)
	}
}

class FetchRoleAction extends DiscordAction {
	execute() {
		return this.client.fetchRole(
			this.required(this.params.guildId, "guildId"),
			this.required(this.params.id ?? this.params.roleId, "id or roleId"),
			this.params.force
		)
	}
}

class FetchMemberAction extends DiscordAction {
	execute() {
		return this.client.fetchMember(
			this.required(this.params.guildId, "guildId"),
			this.required(
				this.params.id ?? this.params.memberId,
				"id or memberId"
			),
			this.params.force
		)
	}
}

class FetchMessageAction extends DiscordAction {
	execute() {
		return this.client.fetchMessage(
			this.required(this.params.channelId, "channelId"),
			this.required(
				this.params.id ?? this.params.messageId,
				"id or messageId"
			),
			this.params.force
		)
	}
}

class FetchWebhookAction extends DiscordAction {
	execute() {
		return this.client.fetchWebhook(
			this.params.webhookToken
				? {
						id: this.required(this.params.id, "id"),
						token: this.params.webhookToken
					}
				: this.required(this.params.id, "id")
		)
	}
}

class ListChannelsAction extends DiscordAction {
	async execute() {
		return (await this.fetchGuild()).fetchChannels()
	}
}

class ListRolesAction extends DiscordAction {
	async execute() {
		return (await this.fetchGuild()).fetchRoles()
	}
}

class ListMembersAction extends DiscordAction {
	async execute() {
		return (await this.fetchGuild()).fetchMembers(
			Math.min(this.params.limit ?? 10, 1000)
		)
	}
}

class ListScheduledEventsAction extends DiscordAction {
	async execute() {
		return (await this.fetchGuild()).fetchScheduledEvents(true)
	}
}

class SearchMessagesAction extends DiscordAction {
	async execute() {
		return (await this.fetchGuild()).searchMessages({
			limit: Math.min(this.params.limit ?? 10, 25),
			channel_id: [this.required(this.params.channelId, "channelId")],
			...(this.params.query ? { content: this.params.query } : {})
		})
	}
}

const raw = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(raw)
	if (value && typeof value === "object" && "rawData" in value)
		return raw((value as { rawData: unknown }).rawData)
	return value
}

const createAction = (client: Client, params: DiscordParams) => {
	if (params.action === "fetch_user")
		return new FetchUserAction(client, params)
	if (params.action === "fetch_guild")
		return new FetchGuildAction(client, params)
	if (params.action === "fetch_channel")
		return new FetchChannelAction(client, params)
	if (params.action === "fetch_role")
		return new FetchRoleAction(client, params)
	if (params.action === "fetch_member")
		return new FetchMemberAction(client, params)
	if (params.action === "fetch_message")
		return new FetchMessageAction(client, params)
	if (params.action === "fetch_webhook")
		return new FetchWebhookAction(client, params)
	if (params.action === "list_channels")
		return new ListChannelsAction(client, params)
	if (params.action === "list_roles")
		return new ListRolesAction(client, params)
	if (params.action === "list_members")
		return new ListMembersAction(client, params)
	if (params.action === "list_scheduled_events")
		return new ListScheduledEventsAction(client, params)
	return new SearchMessagesAction(client, params)
}

class DiscordTool extends Tool<typeof discordSchema> {
	name = "discord"
	label = "Discord"
	description =
		"Fetch Discord user/guild/channel/role/member/message/webhook info, list guild channels/roles/members/events, or search messages in a channel."
	parameters = discordSchema

	constructor(private getClient: () => Client) {
		super()
	}

	protected async execute(toolCallId: string, params: DiscordParams) {
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

		try {
			const rawResult = raw(
				await createAction(this.getClient(), params).execute()
			)
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
						type: "text" as const,
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
}

export const createDiscordTool = (getClient: () => Client) =>
	new DiscordTool(getClient).toDefinition()
