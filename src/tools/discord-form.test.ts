import { afterEach, expect, mock, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	BaseComponentInteraction,
	type Client,
	ModalInteraction
} from "@buape/carbon"
import { createDiscordForms } from "./discord-form"

const dirs: string[] = []
afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true })
})
const form = {
	customId: "start",
	guildId: "g",
	channelId: "c",
	messageId: "m",
	title: "Example",
	skill: "example",
	blockedRoleIds: ["blocked"],
	fields: [
		{ id: "dates", label: "Dates", type: "text" as const },
		{ id: "reason", label: "Reason", type: "paragraph" as const },
		{ id: "private", label: "Private", type: "checkbox" as const }
	]
}
async function setup() {
	const dir = mkdtempSync(join(tmpdir(), "catty-form-test-"))
	dirs.push(dir)
	const path = join(dir, "forms.json")
	const forms = createDiscordForms(path)
	await forms.tool.execute(
		"test",
		{ action: "register", form },
		undefined,
		undefined,
		{} as Parameters<typeof forms.tool.execute>[4]
	)
	const rest = {
		post: mock(
			async (
				_route: string,
				_options: {
					body: {
						type: number
						data: {
							custom_id: string
							flags?: number
							components: { component: { type: number } }[]
						}
					}
				}
			) => ({
				resource: {
					message: {
						id: "reply",
						channel_id: "c",
						author: { id: "app" }
					}
				}
			})
		),
		patch: mock(async () => ({}))
	}
	const client = {
		clientId: "app",
		rest,
		cache: {
			messages: { set: async () => {} },
			users: { set: async () => {} }
		}
	} as unknown as Client
	const button = (overrides = {}) =>
		new BaseComponentInteraction(
			client,
			{
				id: "i",
				application_id: "app",
				token: "secret",
				type: 3,
				guild_id: "g",
				channel: { id: "c" },
				member: { user: { id: "u" }, roles: [] },
				message: { id: "m" },
				data: { custom_id: "start", component_type: 2 },
				...overrides
			} as unknown as ConstructorParameters<
				typeof BaseComponentInteraction
			>[1],
			{}
		)
	const submit = (customId: string, overrides = {}) =>
		new ModalInteraction(
			client,
			{
				id: "s",
				application_id: "app",
				token: "secret",
				type: 5,
				guild_id: "g",
				channel: { id: "c" },
				member: { user: { id: "u" }, roles: [] },
				data: {
					custom_id: customId,
					components: [
						{
							type: 18,
							component: {
								type: 4,
								custom_id: "dates",
								value: "next week"
							}
						},
						{
							type: 18,
							component: {
								type: 4,
								custom_id: "reason",
								value: "family"
							}
						},
						{
							type: 18,
							component: {
								type: 23,
								custom_id: "private",
								value: true
							}
						}
					]
				},
				...overrides
			} as unknown as ConstructorParameters<typeof ModalInteraction>[1],
			{}
		)
	return { forms, rest, path, button, submit }
}

test("opens modal immediately; submission returns typed fields, not business effects", async () => {
	const { forms, rest, button, submit } = await setup()
	expect(await forms.open(button())).toBe(true)
	const callback = rest.post.mock.calls[0]![1].body
	expect(callback.type).toBe(9)
	expect(callback.data.components.map((c) => c.component.type)).toEqual([
		4, 4, 23
	])
	expect(await forms.submission(submit(callback.data.custom_id))).toEqual({
		skill: "example",
		customId: "start",
		messageId: "m",
		fields: { dates: "next week", reason: "family", private: true }
	})
	expect(rest.post).toHaveBeenCalledTimes(1)
	await forms.submission(submit(callback.data.custom_id))
	expect(rest.post.mock.calls[1]![1].body.type).toBe(4)
})
test("blocked role receives ephemeral rejection rather than modal", async () => {
	const { forms, rest, button } = await setup()
	await forms.open(
		button({ member: { user: { id: "u" }, roles: ["blocked"] } })
	)
	expect(rest.post.mock.calls[0]![1].body.data.flags).toBe(64)
})
test("registration survives restart; scope requires exact guild/channel/message", async () => {
	const { rest, path, button } = await setup()
	const reloaded = createDiscordForms(path)
	expect(await reloaded.open(button({ guild_id: "other" }))).toBe(false)
	expect(await reloaded.open(button({ channel: { id: "other" } }))).toBe(
		false
	)
	expect(await reloaded.open(button({ message: { id: "other" } }))).toBe(
		false
	)
	expect(rest.post).not.toHaveBeenCalled()
	expect(await reloaded.open(button())).toBe(true)
})
test("user binding and restart reject stale or stolen forms", async () => {
	const { forms, rest, button, submit, path } = await setup()
	await forms.open(button())
	const id = rest.post.mock.calls[0]![1].body.data.custom_id
	expect(
		await forms.submission(
			submit(id, { member: { user: { id: "other" }, roles: [] } })
		)
	).toBeUndefined()
	expect(
		await createDiscordForms(path).submission(submit(id))
	).toBeUndefined()
	expect(await forms.submission(submit(id))).toBeDefined()
})
test("empty required fields fail without invoking skill", async () => {
	const { forms, rest, button, submit } = await setup()
	await forms.open(button())
	const id = rest.post.mock.calls[0]![1].body.data.custom_id
	expect(
		await forms.submission(
			submit(id, { data: { custom_id: id, components: [] } })
		)
	).toBeUndefined()
})
test("duplicate field IDs are rejected", async () => {
	const { forms } = await setup()
	await expect(
		forms.tool.execute(
			"test",
			{
				action: "register",
				form: { ...form, fields: [form.fields[0]!, form.fields[0]!] }
			},
			undefined,
			undefined,
			{} as Parameters<typeof forms.tool.execute>[4]
		)
	).rejects.toThrow("unique")
})
