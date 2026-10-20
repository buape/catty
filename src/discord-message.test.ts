import { describe, expect, mock, test } from "bun:test"
import {
	BaseComponentInteraction,
	type Client,
	ComponentType,
	InteractionType,
	MessageFlags,
	Routes
} from "@buape/carbon"
import { replyToDeferredComponentInteraction } from "./discord-message"

// Exercise Carbon's real defer/reply/followUp implementation with only REST
// mocked, so these tests catch accidentally posting to the channel again.
const setup = async () => {
	const rest = {
		post: mock(async (_route: string, _options: { body: unknown }) => ({})),
		patch: mock(async () => ({ id: "message", channelId: "channel" })),
		delete: mock(async () => undefined)
	}
	const client = { clientId: "123", rest } as unknown as Client
	const interaction = new BaseComponentInteraction(
		client,
		{
			id: "456",
			application_id: "123",
			token: "test-token",
			type: InteractionType.MessageComponent,
			data: { component_type: ComponentType.Button, custom_id: "test" }
		} as ConstructorParameters<typeof BaseComponentInteraction>[1],
		{}
	)
	await interaction.defer()
	expect(rest.post).toHaveBeenCalledTimes(1)
	return { interaction, rest }
}

const original = Routes.webhookMessage("123", "test-token", "@original")

describe("deferred component responses", () => {
	test("edits the deferred response for text", async () => {
		const { interaction, rest } = await setup()
		await replyToDeferredComponentInteraction(interaction, "Done")
		expect(rest.patch).toHaveBeenCalledWith(original, {
			body: { content: "Done", flags: undefined }
		})
		expect(rest.post).toHaveBeenCalledTimes(1)
	})

	test("sends only intentional overflow as interaction follow-ups", async () => {
		const { interaction, rest } = await setup()
		await replyToDeferredComponentInteraction(interaction, "x".repeat(2000))
		expect(rest.patch).toHaveBeenCalledTimes(1)
		expect(rest.post).toHaveBeenCalledTimes(2)
		expect(rest.post.mock.calls[1]).toEqual([
			Routes.webhook("123", "test-token"),
			{ body: { content: "x".repeat(100), flags: undefined } }
		])
	})

	test.each(["cv2", "discord-components-v2", "catty-discord-components-v2"])(
		"patches raw %s JSON into the deferred response",
		async (language) => {
			const { interaction, rest } = await setup()
			await replyToDeferredComponentInteraction(
				interaction,
				`Result\n\`\`\`${language}\n{"components":[{"type":10,"content":"View"}]}\n\`\`\``
			)
			expect(rest.patch).toHaveBeenCalledWith(original, {
				body: {
					components: [
						{ type: 10, content: "Result" },
						{ type: 10, content: "View" }
					],
					flags: MessageFlags.IsComponentsV2
				}
			})
			expect(rest.post).toHaveBeenCalledTimes(1)
		}
	)

	test("deletes the deferred response for NO_REPLY", async () => {
		const { interaction, rest } = await setup()
		await replyToDeferredComponentInteraction(interaction, " NO_REPLY \n")
		expect(rest.delete).toHaveBeenCalledWith(original)
		expect(rest.patch).not.toHaveBeenCalled()
		expect(rest.post).toHaveBeenCalledTimes(1)
	})

	test("completes empty output with the existing fallback text", async () => {
		const { interaction, rest } = await setup()
		await replyToDeferredComponentInteraction(interaction, "\n")
		expect(rest.patch).toHaveBeenCalledWith(original, {
			body: { content: "No text response.", flags: undefined }
		})
	})

	test("surfaces malformed views for the handler's error response", async () => {
		const { interaction, rest } = await setup()
		await expect(
			replyToDeferredComponentInteraction(interaction, "```cv2\n{}\n```")
		).rejects.toThrow("components array")
		expect(rest.patch).not.toHaveBeenCalled()
	})
})
