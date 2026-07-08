import { type Client, Routes } from "@buape/carbon"
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
	messageId: Type.Optional(Type.String()),
	emoji: Type.Optional(
		Type.String({
			description:
				"Emoji to react with. Unicode emoji, or custom emoji formatted as name:id."
		})
	),
	name: Type.Optional(Type.String()),
	reason: Type.Optional(Type.String()),
	color: Type.Optional(Type.Number()),
	hoist: Type.Optional(Type.Boolean()),
	mentionable: Type.Optional(Type.Boolean()),
	permissions: Type.Optional(Type.String()),
	channelType: Type.Optional(Type.Number()),
	parentId: Type.Optional(Type.String()),
	topic: Type.Optional(Type.String()),
	nsfw: Type.Optional(Type.Boolean()),
	permissionTargetId: Type.Optional(Type.String()),
	permissionTargetType: Type.Optional(
		Type.Union([Type.Literal("role"), Type.Literal("member")])
	),
	allow: Type.Optional(Type.String()),
	deny: Type.Optional(Type.String()),
	nickname: Type.Optional(Type.String()),
	timeoutUntil: Type.Optional(Type.String()),
	timeoutMinutes: Type.Optional(Type.Number()),
	deleteMessageDays: Type.Optional(Type.Number()),
	channelData: Type.Optional(
		Type.Record(Type.String(), Type.Any(), {
			description:
				"Raw Discord channel create/edit JSON body fields. Use Discord API snake_case keys."
		})
	),
	roleData: Type.Optional(
		Type.Record(Type.String(), Type.Any(), {
			description:
				"Raw Discord role create/edit JSON body fields. Use Discord API snake_case keys."
		})
	)
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
	]),
	Type.Intersect([
		commonSchema,
		Type.Object({
			action: Type.Literal("react_message"),
			channelId: Type.String(),
			id: Type.String({ description: "Message ID" }),
			emoji: Type.String({
				description:
					"Emoji to react with. Unicode emoji, or custom emoji formatted as name:id."
			})
		})
	]),
	Type.Intersect([
		commonSchema,
		Type.Object({
			action: Type.Literal("pin_message"),
			channelId: Type.String(),
			id: Type.String({ description: "Message ID" })
		})
	]),
	Type.Intersect([
		commonSchema,
		Type.Object({
			action: Type.Literal("unpin_message"),
			channelId: Type.String(),
			id: Type.String({ description: "Message ID" })
		})
	]),
	Type.Intersect([
		commonSchema,
		Type.Object({
			action: Type.Literal("create_role"),
			guildId: Type.String(),
			name: Type.String()
		})
	]),
	Type.Intersect([
		commonSchema,
		Type.Object({
			action: Type.Literal("create_channel"),
			guildId: Type.String(),
			name: Type.String()
		})
	]),
	Type.Intersect([
		commonSchema,
		Type.Object({
			action: Type.Literal("edit_role"),
			guildId: Type.String(),
			id: Type.String({ description: "Role ID" })
		})
	]),
	Type.Intersect([
		commonSchema,
		Type.Object({
			action: Type.Literal("edit_channel"),
			channelId: Type.String()
		})
	]),
	Type.Intersect([
		commonSchema,
		Type.Object({
			action: Type.Literal("edit_channel_permissions"),
			channelId: Type.String(),
			permissionTargetId: Type.String(),
			permissionTargetType: Type.Union([
				Type.Literal("role"),
				Type.Literal("member")
			])
		})
	]),
	Type.Intersect([
		commonSchema,
		Type.Object({
			action: Type.Literal("add_member_role"),
			guildId: Type.String(),
			memberId: Type.String(),
			roleId: Type.String()
		})
	]),
	Type.Intersect([
		commonSchema,
		Type.Object({
			action: Type.Literal("remove_member_role"),
			guildId: Type.String(),
			memberId: Type.String(),
			roleId: Type.String()
		})
	]),
	Type.Intersect([
		commonSchema,
		Type.Object({
			action: Type.Literal("set_member_nickname"),
			guildId: Type.String(),
			memberId: Type.String()
		})
	]),
	Type.Intersect([
		commonSchema,
		Type.Object({
			action: Type.Literal("timeout_member"),
			guildId: Type.String(),
			memberId: Type.String()
		})
	]),
	Type.Intersect([
		commonSchema,
		Type.Object({
			action: Type.Literal("kick_member"),
			guildId: Type.String(),
			memberId: Type.String()
		})
	]),
	Type.Intersect([
		commonSchema,
		Type.Object({
			action: Type.Literal("ban_member"),
			guildId: Type.String(),
			memberId: Type.String()
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
		return this.client.fetchUser(this.required(this.params.id, "id"))
	}
}

class FetchGuildAction extends DiscordAction {
	execute() {
		return this.client.fetchGuild(
			this.required(
				this.params.id ?? this.params.guildId,
				"id or guildId"
			)
		)
	}
}

class FetchChannelAction extends DiscordAction {
	execute() {
		return this.client.fetchChannel(
			this.required(
				this.params.id ?? this.params.channelId,
				"id or channelId"
			)
		)
	}
}

class FetchRoleAction extends DiscordAction {
	execute() {
		return this.client.fetchRole(
			this.required(this.params.guildId, "guildId"),
			this.required(this.params.id ?? this.params.roleId, "id or roleId")
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
			)
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
			)
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
		return this.client.rest.get(
			Routes.guildMessagesSearch(
				this.required(this.params.guildId, "guildId")
			),
			{
				limit: Math.min(this.params.limit ?? 10, 25),
				channel_id: this.required(this.params.channelId, "channelId"),
				...(this.params.query ? { content: this.params.query } : {})
			}
		)
	}
}

class ReactMessageAction extends DiscordAction {
	async execute() {
		await this.client.rest.put(
			Routes.channelMessageOwnReaction(
				this.required(this.params.channelId, "channelId"),
				this.required(this.params.id ?? this.params.messageId, "id"),
				encodeURIComponent(this.required(this.params.emoji, "emoji"))
			),
			{}
		)
		return { ok: true }
	}
}

class PinMessageAction extends DiscordAction {
	async execute() {
		await (
			await this.client.fetchMessage(
				this.required(this.params.channelId, "channelId"),
				this.required(this.params.id ?? this.params.messageId, "id")
			)
		).pin()
		return { ok: true }
	}
}

class UnpinMessageAction extends DiscordAction {
	async execute() {
		await (
			await this.client.fetchMessage(
				this.required(this.params.channelId, "channelId"),
				this.required(this.params.id ?? this.params.messageId, "id")
			)
		).unpin()
		return { ok: true }
	}
}

class CreateRoleAction extends DiscordAction {
	async execute() {
		return this.client.rest.post(
			Routes.guildRoles(this.required(this.params.guildId, "guildId")),
			{
				body: {
					...this.params.roleData,
					name: this.required(this.params.name, "name"),
					...(this.params.color !== undefined
						? { color: this.params.color }
						: {}),
					...(this.params.hoist !== undefined
						? { hoist: this.params.hoist }
						: {}),
					...(this.params.mentionable !== undefined
						? { mentionable: this.params.mentionable }
						: {}),
					...(this.params.permissions !== undefined
						? { permissions: this.params.permissions }
						: {})
				}
			}
		)
	}
}

class EditRoleAction extends DiscordAction {
	async execute() {
		return this.client.rest.patch(
			Routes.guildRole(
				this.required(this.params.guildId, "guildId"),
				this.required(
					this.params.id ?? this.params.roleId,
					"id or roleId"
				)
			),
			{
				body: {
					...this.params.roleData,
					...(this.params.name !== undefined
						? { name: this.params.name }
						: {}),
					...(this.params.color !== undefined
						? { color: this.params.color }
						: {}),
					...(this.params.hoist !== undefined
						? { hoist: this.params.hoist }
						: {}),
					...(this.params.mentionable !== undefined
						? { mentionable: this.params.mentionable }
						: {}),
					...(this.params.permissions !== undefined
						? { permissions: this.params.permissions }
						: {})
				}
			}
		)
	}
}

class CreateChannelAction extends DiscordAction {
	async execute() {
		return this.client.rest.post(
			Routes.guildChannels(this.required(this.params.guildId, "guildId")),
			{
				body: {
					...this.params.channelData,
					name: this.required(this.params.name, "name"),
					type:
						this.params.channelType ??
						this.params.channelData?.type ??
						0,
					...(this.params.parentId
						? { parent_id: this.params.parentId }
						: {}),
					...(this.params.topic !== undefined
						? { topic: this.params.topic }
						: {}),
					...(this.params.nsfw !== undefined
						? { nsfw: this.params.nsfw }
						: {})
				}
			}
		)
	}
}

class EditChannelAction extends DiscordAction {
	async execute() {
		return this.client.rest.patch(
			Routes.channel(this.required(this.params.channelId, "channelId")),
			{
				body: {
					...this.params.channelData,
					...(this.params.name !== undefined
						? { name: this.params.name }
						: {}),
					...(this.params.parentId !== undefined
						? { parent_id: this.params.parentId }
						: {}),
					...(this.params.topic !== undefined
						? { topic: this.params.topic }
						: {}),
					...(this.params.nsfw !== undefined
						? { nsfw: this.params.nsfw }
						: {})
				}
			}
		)
	}
}

class EditChannelPermissionsAction extends DiscordAction {
	async execute() {
		await this.client.rest.put(
			Routes.channelPermission(
				this.required(this.params.channelId, "channelId"),
				this.required(
					this.params.permissionTargetId,
					"permissionTargetId"
				)
			),
			{
				body: {
					type: this.params.permissionTargetType === "member" ? 1 : 0,
					allow: this.params.allow ?? "0",
					deny: this.params.deny ?? "0"
				}
			}
		)
		return { ok: true }
	}
}

class AddMemberRoleAction extends DiscordAction {
	async execute() {
		await (
			await this.client.fetchMember(
				this.required(this.params.guildId, "guildId"),
				this.required(
					this.params.memberId ?? this.params.id,
					"memberId"
				)
			)
		).addRole(
			this.required(this.params.roleId, "roleId"),
			this.params.reason
		)
		return { ok: true }
	}
}

class RemoveMemberRoleAction extends DiscordAction {
	async execute() {
		await (
			await this.client.fetchMember(
				this.required(this.params.guildId, "guildId"),
				this.required(
					this.params.memberId ?? this.params.id,
					"memberId"
				)
			)
		).removeRole(
			this.required(this.params.roleId, "roleId"),
			this.params.reason
		)
		return { ok: true }
	}
}

class SetMemberNicknameAction extends DiscordAction {
	async execute() {
		await (
			await this.client.fetchMember(
				this.required(this.params.guildId, "guildId"),
				this.required(
					this.params.memberId ?? this.params.id,
					"memberId"
				)
			)
		).setNickname(this.params.nickname ?? null, this.params.reason)
		return { ok: true }
	}
}

class TimeoutMemberAction extends DiscordAction {
	async execute() {
		const minutes = this.params.timeoutMinutes
		const until =
			this.params.timeoutUntil ??
			new Date(
				Date.now() +
					Number(
						this.required(
							minutes?.toString(),
							"timeoutUntil or timeoutMinutes"
						)
					) *
						60 *
						1000
			).toISOString()
		await (
			await this.client.fetchMember(
				this.required(this.params.guildId, "guildId"),
				this.required(
					this.params.memberId ?? this.params.id,
					"memberId"
				)
			)
		).timeoutMember(until, this.params.reason)
		return { ok: true, until }
	}
}

class KickMemberAction extends DiscordAction {
	async execute() {
		await (
			await this.client.fetchMember(
				this.required(this.params.guildId, "guildId"),
				this.required(
					this.params.memberId ?? this.params.id,
					"memberId"
				)
			)
		).kick(this.params.reason)
		return { ok: true }
	}
}

class BanMemberAction extends DiscordAction {
	async execute() {
		await (
			await this.client.fetchMember(
				this.required(this.params.guildId, "guildId"),
				this.required(
					this.params.memberId ?? this.params.id,
					"memberId"
				)
			)
		).ban({
			reason: this.params.reason,
			deleteMessageDays: this.params.deleteMessageDays
		})
		return { ok: true }
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
	if (params.action === "search_messages")
		return new SearchMessagesAction(client, params)
	if (params.action === "react_message")
		return new ReactMessageAction(client, params)
	if (params.action === "pin_message")
		return new PinMessageAction(client, params)
	if (params.action === "unpin_message")
		return new UnpinMessageAction(client, params)
	if (params.action === "create_role")
		return new CreateRoleAction(client, params)
	if (params.action === "edit_role") return new EditRoleAction(client, params)
	if (params.action === "create_channel")
		return new CreateChannelAction(client, params)
	if (params.action === "edit_channel")
		return new EditChannelAction(client, params)
	if (params.action === "edit_channel_permissions")
		return new EditChannelPermissionsAction(client, params)
	if (params.action === "add_member_role")
		return new AddMemberRoleAction(client, params)
	if (params.action === "remove_member_role")
		return new RemoveMemberRoleAction(client, params)
	if (params.action === "set_member_nickname")
		return new SetMemberNicknameAction(client, params)
	if (params.action === "timeout_member")
		return new TimeoutMemberAction(client, params)
	if (params.action === "kick_member")
		return new KickMemberAction(client, params)
	return new BanMemberAction(client, params)
}

class DiscordTool extends Tool<typeof discordSchema> {
	name = "discord"
	label = "Discord"
	description =
		"Fetch Discord info, search messages, react/pin messages, create/edit roles/channels, edit channel permissions, manage member roles/nicknames, and timeout/kick/ban members."
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
			emoji: params.emoji,
			name: params.name,
			permissionTargetId: params.permissionTargetId,
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
