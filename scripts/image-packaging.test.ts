import { afterAll, expect, test } from "bun:test"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const temp = mkdtempSync(join(tmpdir(), "catty-image-packaging-"))
const root = join(import.meta.dir, "..")
const binary = join(temp, "image-smoke")
afterAll(() => rmSync(temp, { recursive: true, force: true }))

test("compiled image processing works without build-machine paths", async () => {
	const build = Bun.spawn(
		[
			process.execPath,
			"build",
			join(import.meta.dir, "image-smoke.ts"),
			"--compile",
			"--define",
			'__dirname="/__catty_build_source_unavailable__"',
			"--outfile",
			binary
		],
		{ cwd: root, stdout: "pipe", stderr: "pipe" }
	)
	expect(await build.exited).toBe(0)

	// Missing WASM must reproduce the failure, even with a valid tiny PNG.
	const missing = Bun.spawn([binary], {
		cwd: temp,
		stdout: "pipe",
		stderr: "pipe"
	})
	expect(await missing.exited).not.toBe(0)

	const copy = Bun.spawn([process.execPath, "scripts/copy-image-wasm.ts"], {
		cwd: root,
		stdout: "pipe",
		stderr: "pipe"
	})
	expect(await copy.exited).toBe(0)
	copyFileSync(
		join(root, "dist/photon_rs_bg.wasm"),
		join(temp, "photon_rs_bg.wasm")
	)

	// Match Homebrew: executable reached through a symlink, asset beside its
	// real binary, and an unrelated working directory with no node_modules.
	const bin = join(temp, "bin")
	const cwd = join(temp, "workspace")
	mkdirSync(bin)
	mkdirSync(cwd)
	const link = Bun.spawn(["ln", "-s", binary, join(bin, "image-smoke")])
	expect(await link.exited).toBe(0)
	const installed = Bun.spawn([join(bin, "image-smoke")], {
		cwd,
		stdout: "pipe",
		stderr: "pipe"
	})
	expect(await installed.exited).toBe(0)
	expect(await new Response(installed.stdout).text()).toContain(
		"Image smoke test passed"
	)
}, 60000)
