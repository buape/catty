import {
	type AgentToolResult,
	defineTool
} from "@earendil-works/pi-coding-agent"
import type { Static, TSchema } from "typebox"

export abstract class Tool<TParams extends TSchema> {
	abstract name: string
	abstract label: string
	abstract description: string
	abstract parameters: TParams

	toDefinition() {
		return defineTool({
			name: this.name,
			label: this.label,
			description: this.description,
			parameters: this.parameters,
			execute: (toolCallId, params) => this.execute(toolCallId, params)
		})
	}

	protected abstract execute(
		toolCallId: string,
		params: Static<TParams>
	): Promise<AgentToolResult<unknown>>
}
