import "../../codemode-runtime"
import { CodemodeSandbox, loadQuickJSWasm } from "@earendil-works/pi-codemode"
import {
	getCodemodeWorkerSpecifier,
	getQuickJSWasmPath
} from "../../../node_modules/@earendil-works/pi-coding-agent/dist/config.js"

const sandbox = new CodemodeSandbox({
	workerUrl: getCodemodeWorkerSpecifier(),
	wasm: loadQuickJSWasm(getQuickJSWasmPath()),
	tools: [{ name: "echo", execute: (args) => args }]
})
try {
	const result = await sandbox.execute(
		"text(await tools.echo({ answer: 42 })); text(typeof process); text(typeof fetch)"
	)
	if (!result.ok) throw new Error(result.error.message)
	if (
		JSON.stringify(result.output) !==
		JSON.stringify([
			{ type: "text", text: '{"answer":42}' },
			{ type: "text", text: "undefined" },
			{ type: "text", text: "undefined" }
		])
	)
		throw new Error(
			`Unexpected sandbox output: ${JSON.stringify(result.output)}`
		)
	if (result.calls.length !== 1 || result.calls[0]?.status !== "ok")
		throw new Error("Tool bridge did not execute successfully")
	console.log("Codemode smoke test passed")
} finally {
	await sandbox.close()
}
