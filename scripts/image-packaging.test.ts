import { afterAll, expect, test } from "bun:test"
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	symlinkSync
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { embedPhoton } from "./embed-photon"

const temp = mkdtempSync(join(tmpdir(), "catty-image-packaging-"))
const binary = join(temp, "image-smoke")
const entrypoint = join(import.meta.dir, "image-smoke.ts")
afterAll(() => rmSync(temp, { recursive: true, force: true }))

test("compiled images work with only the executable installed", async () => {
	// Make the old computed lookup unusable even on the build machine.
	const define = { __dirname: '"/__catty_build_source_unavailable__"' }
	const missingBuild = await Bun.build({
		entrypoints: [entrypoint],
		compile: { outfile: binary },
		define
	})
	expect(missingBuild.success).toBe(true)
	const missing = Bun.spawn([binary], {
		cwd: temp,
		stdout: "pipe",
		stderr: "pipe"
	})
	expect(await missing.exited).not.toBe(0)

	const embeddedBuild = await Bun.build({
		entrypoints: [entrypoint],
		compile: { outfile: binary },
		define,
		loader: { ".wasm": "file" },
		plugins: [embedPhoton]
	})
	expect(embeddedBuild.success).toBe(true)

	// Homebrew-style symlink and unrelated working directory: no sidecars,
	// node_modules, runtime extraction, or additional installed executables.
	const bin = join(temp, "bin")
	const cwd = join(temp, "workspace")
	mkdirSync(bin)
	mkdirSync(cwd)
	symlinkSync(binary, join(bin, "image-smoke"))
	const before = readdirSync(temp).sort()
	const installed = Bun.spawn([join(bin, "image-smoke")], {
		cwd,
		stdout: "pipe",
		stderr: "pipe"
	})
	expect(await installed.exited).toBe(0)
	expect(await new Response(installed.stdout).text()).toContain(
		"Image smoke test passed"
	)
	expect(readdirSync(temp).sort()).toEqual(before)
	expect(readdirSync(cwd)).toEqual([])
	expect(readdirSync(bin)).toEqual(["image-smoke"])
}, 60000)
