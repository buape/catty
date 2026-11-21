import { afterAll, expect, test } from "bun:test"
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	symlinkSync
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
const temp = mkdtempSync(join(tmpdir(), "catty-codemode-packaging-"))
const binary = join(temp, "codemode-smoke")
const entrypoints = [
	join(root, "src/extensions/codemode/smoke.ts"),
	join(root, "src/extensions/codemode/worker.ts")
]
afterAll(() => rmSync(temp, { recursive: true, force: true }))

test("compiled codemode worker and WASM work from an unrelated empty workspace", async () => {
	// Like production, both entrypoints live underneath src/. Bun's inferred root
	// strips that prefix, breaking Pi's ./src/extensions/codemode/worker.ts lookup.
	const broken = await Bun.build({
		entrypoints,
		compile: { outfile: binary },
		loader: { ".wasm": "file" }
	})
	expect(broken.success).toBe(true)
	const failed = Bun.spawn([binary], {
		cwd: temp,
		stdout: "pipe",
		stderr: "pipe"
	})
	expect(await failed.exited).not.toBe(0)
	expect(await new Response(failed.stderr).text()).toContain(
		"Cannot find module"
	)

	const fixed = await Bun.build({
		root,
		entrypoints,
		compile: { outfile: binary },
		loader: { ".wasm": "file" }
	})
	expect(fixed.success).toBe(true)
	const bin = join(temp, "bin")
	const cwd = join(temp, "workspace")
	mkdirSync(bin)
	mkdirSync(cwd)
	symlinkSync(binary, join(bin, "codemode-smoke"))
	const before = readdirSync(temp).sort()
	const child = Bun.spawn([join(bin, "codemode-smoke")], {
		cwd,
		stdout: "pipe",
		stderr: "pipe"
	})
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited
	])
	expect(stderr).toBe("")
	expect(code).toBe(0)
	expect(stdout).toContain("Codemode smoke test passed")
	expect(readdirSync(temp).sort()).toEqual(before)
	expect(readdirSync(cwd)).toEqual([])
	expect(readdirSync(bin)).toEqual(["codemode-smoke"])
}, 60000)
