import { resolve } from "node:path"
import { embedPhoton } from "./embed-photon"

const [
	target = `bun-${process.platform}-${process.arch}`,
	outfile = "dist/catty"
] = process.argv.slice(2)
const result = await Bun.build({
	// Pi resolves the embedded worker as ./src/extensions/codemode/worker.ts.
	// Without a fixed root Bun strips the shared src/ prefix from entrypoints.
	root: resolve(import.meta.dir, ".."),
	entrypoints: ["src/index.ts", "src/extensions/codemode/worker.ts"],
	compile: { target: target as Bun.Build.CompileTarget, outfile },
	external: ["@node-llama-cpp/*"],
	loader: { ".wasm": "file" },
	plugins: [embedPhoton]
})
if (!result.success)
	throw new AggregateError(result.logs, "Binary build failed")
