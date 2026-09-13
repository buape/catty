import { existsSync, readFileSync } from "node:fs"
import { homedir, platform } from "node:os"
import { join, resolve } from "node:path"
import { getAgentDir, ModelRuntime } from "@earendil-works/pi-coding-agent"

export const isCattyAuthCommand = (command: string | undefined) =>
	command === "auth" || command === "login"

const resolveHome = (path: string) => path.replace(/^~(?=$|\/)/, homedir())

const configValue = (args: string[], name: string) => {
	const index = args.indexOf(name)
	return index === -1 ? undefined : args[index + 1]
}

const commandValues = (args: string[], name: string) => {
	const index = args.indexOf(name)
	const values: string[] = []
	for (let i = index + 1; i > 0 && i < args.length; i++) {
		const arg = args[i]
		if (arg === "--name" || arg === "--config") i++
		else if (arg && !arg.startsWith("--")) values.push(arg)
	}
	return values
}

const tryOpenUrl = (url: string) => {
	const command =
		platform() === "darwin"
			? ["open", url]
			: platform() === "win32"
				? ["cmd", "/c", "start", "", url]
				: ["xdg-open", url]
	try {
		Bun.spawn(command, { stdout: "ignore", stderr: "ignore" })
		return true
	} catch {
		return false
	}
}

const authSettings = (
	args: string[],
	cattyDir: string,
	namedAgents: string[],
	hasRootAgent: boolean
) => {
	let authAgent = configValue(args, "--name")
	if (!authAgent && !hasRootAgent && namedAgents.length === 1)
		authAgent = namedAgents[0]
	if (!authAgent && !hasRootAgent && namedAgents.length > 1)
		throw new Error(
			`Choose an agent: ${namedAgents.map((name) => `catty --name ${name} auth`).join(", ")}`
		)

	const agentRoot = authAgent ? join(cattyDir, authAgent) : cattyDir
	const path = configValue(args, "--config") ?? join(agentRoot, "config.toml")
	let piAgentDir = getAgentDir()
	let apiKeys: Record<string, string> = {}
	if (existsSync(path)) {
		const parsed = Bun.TOML.parse(readFileSync(path, "utf8")) as {
			pi?: { agentDir?: string; apiKeys?: Record<string, string> }
		}
		if (parsed.pi?.agentDir)
			piAgentDir = resolve(resolveHome(parsed.pi.agentDir))
		if (parsed.pi?.apiKeys) apiKeys = parsed.pi.apiKeys
	}
	return {
		apiKeys,
		authPath: join(piAgentDir, "auth.json"),
		modelsPath: join(piAgentDir, "models.json")
	}
}

export const runCattyAuth = async (
	args: string[],
	command: string | undefined,
	cattyDir: string,
	namedAgents: string[],
	hasRootAgent: boolean
) => {
	const values = commandValues(args, command ?? "")
	const action =
		command === "login"
			? "login"
			: ["login", "status", "logout"].includes(values[0] ?? "")
				? values.shift()
				: "login"
	const provider = values[0] ?? "openai-codex"
	if (!action) throw new Error("Missing auth action")
	if (provider !== "openai-codex")
		throw new Error(
			`Only openai-codex OAuth is wired right now: ${provider}`
		)

	const settings = authSettings(args, cattyDir, namedAgents, hasRootAgent)
	const modelRuntime = await ModelRuntime.create({
		authPath: settings.authPath,
		modelsPath: settings.modelsPath
	})
	for (const [keyProvider, key] of Object.entries(settings.apiKeys)) {
		if (typeof key === "string")
			await modelRuntime.setRuntimeApiKey(keyProvider, key)
	}

	if (action === "status") {
		const auth = await modelRuntime.checkAuth(provider)
		const resolved = auth ? await modelRuntime.getAuth(provider) : undefined
		console.log(
			resolved
				? `Logged in: ${provider} (${auth?.type ?? "auth"})`
				: `Not logged in: ${provider}`
		)
		return
	}

	if (action === "logout") {
		await modelRuntime.logout(provider)
		console.log(`Logged out: ${provider}`)
		return
	}

	await modelRuntime.login(provider, "oauth", {
		prompt: async (prompt) => {
			if (prompt.type === "select")
				return (
					prompt.options.find((option) => option.id === "device_code")
						?.id ??
					prompt.options[0]?.id ??
					""
				)
			console.log(prompt.message)
			for await (const chunk of Bun.stdin.stream())
				return new TextDecoder().decode(chunk).trim()
			return ""
		},
		notify: (event) => {
			if (event.type === "device_code") {
				const opened = tryOpenUrl(event.verificationUri)
				console.log(
					opened
						? `Opened ${event.verificationUri}`
						: `Open ${event.verificationUri}`
				)
				console.log(`Enter code: ${event.userCode}`)
				console.log("Waiting for login to finish...")
			} else if (event.type === "auth_url") {
				console.log(event.instructions ?? "Open this URL to continue:")
				console.log(event.url)
				tryOpenUrl(event.url)
			} else console.log(event.message)
		}
	})
	console.log(`Logged in: ${provider}`)
	console.log(`Auth store: ${settings.authPath}`)
}
