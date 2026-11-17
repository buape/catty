import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const home = mkdtempSync(join(tmpdir(), "catty-preview-"))
const bin = join(home, "bin")
mkdirSync(bin)
writeFileSync(join(bin, "pi"), '#!/bin/sh\nprintf "%s\\n" "$@"\n', {
	mode: 0o755
})
for (const agent of ["", "jade"]) {
	const root = join(home, ".catty", agent)
	mkdirSync(join(root, "workspace"), { recursive: true })
	writeFileSync(
		join(root, "config.toml"),
		'[pi]\nchannelSessions = true\n[pi.guilds."123"]\nsession = "guild"\n'
	)
}
afterAll(() => rmSync(home, { recursive: true, force: true }))

const preview = async (...args: string[]) => {
	const child = Bun.spawn(
		[
			process.execPath,
			join(import.meta.dir, "index.ts"),
			"preview",
			...args
		],
		{
			env: { ...Bun.env, HOME: home, PATH: `${bin}:${Bun.env.PATH}` },
			stdout: "pipe",
			stderr: "pipe"
		}
	)
	const [code, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text()
	])
	return { code, stdout, stderr }
}

test("guild preview selects the persistent guild directory", async () => {
	const result = await preview("--guild", "123")
	expect(result.code).toBe(0)
	expect(result.stdout).toContain(
		join(home, ".catty/workspace/.internal/guild-sessions/123")
	)
})

test("named-agent guild preview selects that agent's directory", async () => {
	for (const args of [
		["jade", "--guild", "123"],
		["--name", "jade", "--guild", "123"]
	]) {
		const result = await preview(...args)
		expect(result.code).toBe(0)
		expect(result.stdout).toContain(
			join(home, ".catty/jade/workspace/.internal/guild-sessions/123")
		)
	}
})

test("existing channel preview is unchanged", async () => {
	const result = await preview("456")
	expect(result.code).toBe(0)
	expect(result.stdout).toContain(
		join(home, ".catty/workspace/.internal/channel-sessions/456")
	)
})

test("existing main preview does not select another session directory", async () => {
	const result = await preview()
	expect(result.code).toBe(0)
	expect(result.stdout).not.toContain("--session-dir")
})

test("guild preview rejects a missing ID and mixed channel/guild selectors", async () => {
	const missing = await preview("--guild")
	expect(missing.code).not.toBe(0)
	expect(missing.stderr).toContain("--guild requires a guild ID")
	const mixed = await preview("456", "--guild", "123")
	expect(mixed.code).not.toBe(0)
	expect(mixed.stderr).toContain("Choose a channel ID or --guild, not both")
})

test("first-launch config remains valid TOML", async () => {
	const template = await Bun.file(
		join(import.meta.dir, "../docs/templates/config.toml")
	).text()
	expect(() => Bun.TOML.parse(template)).not.toThrow()
})
