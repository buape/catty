import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import {
	type BaseComponentInteraction,
	type ModalInteraction,
	Routes
} from "@buape/carbon"
import { defineTool } from "@earendil-works/pi-coding-agent"
import { type Static, Type } from "typebox"

const formSchema = Type.Object({
	customId: Type.String({ minLength: 1, maxLength: 80 }),
	guildId: Type.String(),
	channelId: Type.String(),
	messageId: Type.String(),
	title: Type.String({ minLength: 1, maxLength: 45 }),
	skill: Type.String({ pattern: "^[a-zA-Z0-9_-]+$" }),
	blockedRoleIds: Type.Optional(Type.Array(Type.String())),
	blockedMessage: Type.Optional(Type.String({ maxLength: 500 })),
	fields: Type.Array(
		Type.Object({
			id: Type.String({ minLength: 1, maxLength: 100 }),
			label: Type.String({ minLength: 1, maxLength: 45 }),
			type: Type.Union([
				Type.Literal("text"),
				Type.Literal("paragraph"),
				Type.Literal("checkbox")
			]),
			required: Type.Optional(Type.Boolean()),
			maxLength: Type.Optional(
				Type.Integer({ minimum: 1, maximum: 4000 })
			)
		}),
		{ minItems: 1, maxItems: 5 }
	)
})
const schema = Type.Union([
	Type.Object({ action: Type.Literal("register"), form: formSchema }),
	Type.Object({ action: Type.Literal("list") }),
	Type.Object({
		action: Type.Literal("remove"),
		customId: Type.String(),
		messageId: Type.String()
	})
])

// Only generic Discord UI transport lives here. Submission effects belong to
// the selected workspace skill and the agent's normal authorization policy.
export function createDiscordForms(path: string) {
	let forms: Static<typeof formSchema>[] = []
	const pending = new Map<
		string,
		{ form: Static<typeof formSchema>; userId: string; expires: number }
	>()
	try {
		forms = JSON.parse(readFileSync(path, "utf8"))
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
	}
	const save = () => {
		mkdirSync(dirname(path), { recursive: true })
		writeFileSync(`${path}.tmp`, JSON.stringify(forms, null, 2), {
			mode: 0o600
		})
		renameSync(`${path}.tmp`, path)
	}
	const tool = defineTool({
		name: "discord_form",
		label: "Discord forms",
		description:
			"Register persistent Discord modal forms on existing buttons. Catty opens the modal immediately (before deferring), then routes submissions to the named workspace skill. Business logic remains agent-driven. Registration is scoped to an exact guild/channel/message/button. Supports text, paragraph and checkbox fields. Register before inviting clicks. Pending open modals expire after 15 minutes or a restart.",
		parameters: schema,
		async execute(_id, params) {
			if (params.action === "register") {
				if (
					new Set(params.form.fields.map((field) => field.id))
						.size !== params.form.fields.length
				)
					throw new Error("Form field IDs must be unique")
				forms = forms.filter(
					(form) =>
						form.customId !== params.form.customId ||
						form.messageId !== params.form.messageId
				)
				forms.push(params.form)
				save()
			} else if (params.action === "remove") {
				forms = forms.filter(
					(form) =>
						form.customId !== params.customId ||
						form.messageId !== params.messageId
				)
				save()
			}
			return {
				content: [{ type: "text", text: JSON.stringify(forms) }],
				details: {}
			}
		}
	})
	return {
		tool,
		async open(interaction: BaseComponentInteraction) {
			const data = interaction.rawData
			const form = forms.find(
				(form) =>
					form.customId === data.data.custom_id &&
					form.messageId === data.message.id &&
					form.guildId === data.guild_id &&
					form.channelId === (data.channel?.id ?? data.channel_id)
			)
			if (!form) return false
			if (
				form.blockedRoleIds?.some((role) =>
					data.member?.roles.includes(role)
				)
			) {
				await interaction.reply({
					content:
						form.blockedMessage ??
						"You cannot open this form with your current roles.",
					ephemeral: true
				})
				return true
			}
			for (const [key, value] of pending)
				if (value.expires < Date.now()) pending.delete(key)
			const customId = `catty-form:${randomUUID()}`
			pending.set(customId, {
				form,
				userId: String(interaction.userId),
				expires: Date.now() + 15 * 60_000
			})
			try {
				await interaction.client.rest.post(
					Routes.interactionCallback(data.id, data.token),
					{
						body: {
							type: 9,
							data: {
								custom_id: customId,
								title: form.title,
								components: form.fields.map((field) => ({
									type: 18,
									label: field.label,
									component:
										field.type === "checkbox"
											? {
													type: 23,
													custom_id: field.id,
													default: false
												}
											: {
													type: 4,
													custom_id: field.id,
													style:
														field.type ===
														"paragraph"
															? 2
															: 1,
													required:
														field.required ?? true,
													max_length:
														field.maxLength ?? 1000
												}
								}))
							}
						}
					}
				)
			} catch (error) {
				pending.delete(customId)
				throw error
			}
			return true
		},
		async submission(interaction: ModalInteraction) {
			const item = pending.get(interaction.customId)
			const data = interaction.rawData
			if (
				!item ||
				item.expires < Date.now() ||
				item.userId !== String(interaction.userId) ||
				item.form.guildId !== data.guild_id ||
				item.form.channelId !== (data.channel?.id ?? data.channel_id)
			) {
				await interaction.reply({
					content:
						"This form expired or does not belong to you. Please open it again.",
					ephemeral: true
				})
				return
			}
			// Consume before yielding so duplicate deliveries cannot run the skill twice.
			pending.delete(interaction.customId)
			const fields: Record<string, string | boolean> = {}
			for (const field of item.form.fields) {
				const value = interaction.fields.getText(field.id) ?? ""
				if (field.type === "checkbox")
					fields[field.id] = value === "true"
				else {
					if (
						((field.required ?? true) && !value.trim()) ||
						value.length > (field.maxLength ?? 1000)
					) {
						await interaction.reply({
							content:
								"Invalid form fields. Please open the form again.",
							ephemeral: true
						})
						return
					}
					fields[field.id] = value
				}
			}
			return {
				skill: item.form.skill,
				customId: item.form.customId,
				messageId: item.form.messageId,
				fields
			}
		}
	}
}
