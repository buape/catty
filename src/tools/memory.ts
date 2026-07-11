import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { addLineNumbers, createStore, type QMDStore } from "@tobilu/qmd"
import { type Static, Type } from "typebox"
import { Tool } from "./tool"

const memorySchema = Type.Union([
	Type.Object({
		action: Type.Literal("search"),
		query: Type.String(),
		limit: Type.Optional(Type.Number())
	}),
	Type.Object({
		action: Type.Literal("query"),
		query: Type.String(),
		intent: Type.Optional(Type.String()),
		limit: Type.Optional(Type.Number()),
		minScore: Type.Optional(Type.Number()),
		rerank: Type.Optional(Type.Boolean())
	}),
	Type.Object({
		action: Type.Literal("get"),
		file: Type.String({ description: "QMD path or docid, e.g. #abc123" }),
		fromLine: Type.Optional(Type.Number()),
		maxLines: Type.Optional(Type.Number())
	}),
	Type.Object({
		action: Type.Literal("append"),
		content: Type.String(),
		heading: Type.Optional(Type.String())
	}),
	Type.Object({
		action: Type.Literal("update")
	}),
	Type.Object({
		action: Type.Literal("embed"),
		force: Type.Optional(Type.Boolean())
	}),
	Type.Object({
		action: Type.Literal("status")
	})
])

type MemoryParams = Static<typeof memorySchema>

class MemoryTool extends Tool<typeof memorySchema> {
	name = "memory"
	label = "QMD Memory"
	description =
		"Search, retrieve, append to, update, and embed Catty's MEMORY.qmd through QMD. Use this for durable memory recall before answering from long-term memory."
	parameters = memorySchema

	private store?: QMDStore
	private updatedAt = 0

	constructor(
		private workspace: string,
		private memoryPath: string
	) {
		super()
	}

	private async getStore() {
		if (this.store) return this.store
		const dbPath = join(this.workspace, ".internal", "qmd.sqlite")
		mkdirSync(dirname(dbPath), { recursive: true })
		this.store = await createStore({
			dbPath,
			config: {
				global_context:
					"Catty durable memory: primary user context, agent identity/personality, preferences, and reusable notes.",
				collections: {
					memory: {
						path: this.workspace,
						pattern: "MEMORY.qmd",
						includeByDefault: true,
						context: {
							"/": "Catty canonical MEMORY.qmd"
						}
					}
				}
			}
		})
		return this.store
	}

	private async update() {
		const store = await this.getStore()
		const result = await store.update({ collections: ["memory"] })
		this.updatedAt = Date.now()
		return result
	}

	private async ensureFresh() {
		if (Date.now() - this.updatedAt > 1000) await this.update()
	}

	async predownload() {
		console.log("[memory] predownload started")
		let store: QMDStore
		try {
			store = await this.getStore()
			await this.update()
		} catch (error) {
			console.error("[memory] predownload setup failed", error)
			return
		}
		try {
			console.log("[memory] predownload query expansion model")
			await store.expandQuery("Catty memory recall", {
				intent: "Warm up QMD memory recall"
			})
		} catch (error) {
			console.error("[memory] query expansion predownload failed", error)
		}
		try {
			console.log("[memory] predownload embedding model")
			await store.internal.llm?.embed("Catty memory recall", {
				isQuery: true
			})
		} catch (error) {
			console.error("[memory] embedding predownload failed", error)
		}
		console.log("[memory] predownload finished")
	}

	protected async execute(toolCallId: string, params: MemoryParams) {
		console.log("[memory] tool started", {
			id: toolCallId,
			action: params.action
		})
		const store = await this.getStore()

		if (params.action === "status") {
			const status = await store.getStatus()
			const health = await store.getIndexHealth()
			return this.text({ dbPath: store.dbPath, status, health })
		}

		if (params.action === "update") return this.text(await this.update())

		if (params.action === "append") {
			const heading = params.heading ?? "Durable Notes"
			const memory = readFileSync(this.memoryPath, "utf8")
			const section = `\n\n## ${heading}\n\n${params.content.trim()}\n`
			writeFileSync(this.memoryPath, `${memory.trimEnd()}${section}`)
			return this.text({ ok: true, update: await this.update() })
		}

		if (params.action === "embed") {
			await this.update()
			return this.text(
				await store.embed({
					collection: "memory",
					force: params.force
				})
			)
		}

		await this.ensureFresh()

		if (params.action === "search") {
			const results = await store.searchLex(params.query, {
				collection: "memory",
				limit: params.limit ?? 10
			})
			return this.text(
				results.map((result) => ({
					file: result.displayPath,
					docid: result.docid,
					title: result.title,
					score: result.score,
					context: result.context
				}))
			)
		}

		if (params.action === "query") {
			const results = await store.search({
				query: params.query,
				intent: params.intent,
				collection: "memory",
				limit: params.limit ?? 10,
				minScore: params.minScore,
				rerank: params.rerank ?? false
			})
			return this.text(
				results.map((result) => ({
					file: result.displayPath,
					docid: result.docid,
					title: result.title,
					score: result.score,
					context: result.context,
					snippet: result.bestChunk
				}))
			)
		}

		const fromLine = params.fromLine ?? 1
		const body = await store.getDocumentBody(params.file, {
			fromLine,
			maxLines: params.maxLines
		})
		if (body === null) return this.text({ error: "Document not found" })
		return this.text(addLineNumbers(body, fromLine))
	}

	private text(value: unknown) {
		return {
			content: [
				{
					type: "text" as const,
					text:
						typeof value === "string"
							? value
							: JSON.stringify(value, null, 2)
				}
			],
			details: {}
		}
	}
}

export const createMemoryTool = (workspace: string, memoryPath: string) => {
	const tool = new MemoryTool(workspace, memoryPath)
	return {
		definition: tool.toDefinition(),
		predownload: () => tool.predownload()
	}
}
