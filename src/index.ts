import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { homedir, platform, userInfo } from "node:os"
import { dirname, join } from "node:path"
import { AuthStorage, getAgentDir } from "@earendil-works/pi-coding-agent"

const run = async (command: string[]) => {
	console.log(`$ ${command.join(" ")}`)
	const process = Bun.spawn(command, {
		stdout: "inherit",
		stderr: "inherit"
	})
	const code = await process.exited
	if (code !== 0) throw new Error(`${command[0]} exited with ${code}`)
}

const cattyBin = () =>
	Bun.argv[0].endsWith("bun") || Bun.argv[0].endsWith("bun.exe")
		? "/opt/homebrew/bin/catty"
		: Bun.argv[0]

const bunBin = () =>
	Bun.argv[0].endsWith("bun") || Bun.argv[0].endsWith("bun.exe")
		? Bun.argv[0]
		: process.env.BUN_INSTALL
			? join(process.env.BUN_INSTALL, "bin/bun")
			: "/opt/homebrew/bin/bun"

const printHelp = () => {
	console.log(`Catty

Usage:
  catty [--new] [--name NAME] [--config PATH] Start Catty in the foreground
  catty auth login [provider]   Login to pi auth provider
  catty service install         Install the user service
  catty service uninstall       Uninstall the user service
  catty service start           Start the service
  catty service stop            Stop the service
  catty service restart         Restart the service
  catty service status          Show service status
  catty service logs [--follow] Show service logs
  catty help                    Show this help

Options:
  --config PATH                 Use a custom config path
  --name NAME                   Use a named agent config/service namespace
  --dev                         Install service to run bun start in ~/Developer/catty
  --new                         Start a fresh pi session instead of resuming
`)
}

const args = Bun.argv.slice(2)
const command = args.find(
	(arg, index) =>
		!arg.startsWith("--") &&
		args[index - 1] !== "--config" &&
		args[index - 1] !== "--name"
)
const wantsHelp =
	args.includes("help") || args.includes("--help") || args.includes("-h")
const cattyDir = join(homedir(), ".catty")
const namedAgents = existsSync(cattyDir)
	? readdirSync(cattyDir, { withFileTypes: true })
			.filter(
				(entry) => entry.isDirectory() && entry.name !== "workspace"
			)
			.map((entry) => entry.name)
			.filter(
				(name) =>
					existsSync(join(cattyDir, name, "config.toml")) ||
					existsSync(join(cattyDir, name, "workspace"))
			)
	: []
const hasRootAgent =
	existsSync(join(cattyDir, "config.toml")) ||
	existsSync(join(cattyDir, "workspace"))
const usingDefaultConfig = !args.includes("--config")
const usingNamedAgent = args.includes("--name")

if (wantsHelp) {
	printHelp()
	process.exit(0)
}

if (
	usingDefaultConfig &&
	!usingNamedAgent &&
	!hasRootAgent &&
	namedAgents.length > 0
) {
	console.log(
		`Catty is using named agents (${namedAgents.join(", ")}); pass --name NAME.`
	)
	printHelp()
	process.exit(0)
}

const { agentName, config, configPath, workspace } = await import("./config")
const { startCatty } = await import("./agent")

const agentDir = String(config.pi?.agentDir ?? getAgentDir()).replace(
	/^~(?=$|\/)/,
	homedir()
)
const serviceName = agentName ?? "agent"
const serviceLabel = `com.catty.${serviceName}`
const systemdService = agentName
	? `catty-${serviceName}.service`
	: "catty.service"
const devMode = Bun.argv.includes("--dev")
const devRoot = join(homedir(), "Developer/catty")
const logDir = join(homedir(), "Library/Logs/catty")
const logPath = join(logDir, agentName ? `${serviceName}.log` : "catty.log")
const errorLogPath = join(
	logDir,
	agentName ? `${serviceName}.error.log` : "catty.error.log"
)

const serviceFile = () =>
	platform() === "darwin"
		? join(homedir(), "Library/LaunchAgents", `${serviceLabel}.plist`)
		: join(homedir(), ".config/systemd/user", systemdService)

const serviceTarget = () => `gui/${userInfo().uid}/${serviceLabel}`

const installService = async () => {
	mkdirSync(dirname(serviceFile()), { recursive: true })
	mkdirSync(logDir, { recursive: true })
	const nameArgs = agentName
		? `
    <string>--name</string>
    <string>${agentName}</string>`
		: ""
	const devArgs = devMode
		? `<string>${bunBin()}</string>
    <string>start</string>
    <string>--</string>${nameArgs}`
		: `<string>${cattyBin()}</string>${nameArgs}`
	const systemdCommand = devMode
		? `${bunBin()} start --${agentName ? ` --name ${agentName}` : ""} --config ${configPath}`
		: `${cattyBin()}${agentName ? ` --name ${agentName}` : ""} --config ${configPath}`
	const workingDirectory = devMode ? devRoot : workspace

	if (platform() === "darwin") {
		writeFileSync(
			serviceFile(),
			`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${serviceLabel}</string>

  <key>ProgramArguments</key>
  <array>
    ${devArgs}
    <string>--config</string>
    <string>${configPath}</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${workingDirectory}</string>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${logPath}</string>

  <key>StandardErrorPath</key>
  <string>${errorLogPath}</string>
</dict>
</plist>
`
		)
		await run([
			"launchctl",
			"bootstrap",
			`gui/${userInfo().uid}`,
			serviceFile()
		]).catch(() => {})
		await run(["launchctl", "enable", serviceTarget()])
		console.log(`Installed ${serviceFile()}`)
		return
	}

	writeFileSync(
		serviceFile(),
		`[Unit]
Description=Catty personal assistant harness
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${workingDirectory}
ExecStart=${systemdCommand}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`
	)
	await run(["systemctl", "--user", "daemon-reload"])
	await run(["systemctl", "--user", "enable", systemdService])
	console.log(`Installed ${serviceFile()}`)
}

const runService = async (action: string) => {
	if (platform() === "darwin") {
		if (action === "start")
			await run(["launchctl", "kickstart", "-k", serviceTarget()])
		if (action === "stop")
			await run(["launchctl", "bootout", serviceTarget()])
		if (action === "restart") {
			await run(["launchctl", "bootout", serviceTarget()]).catch(() => {})
			await run([
				"launchctl",
				"bootstrap",
				`gui/${userInfo().uid}`,
				serviceFile()
			])
			await run(["launchctl", "kickstart", "-k", serviceTarget()])
		}
		if (action === "status")
			await run(["launchctl", "print", serviceTarget()])
		if (action === "uninstall") {
			await run(["launchctl", "bootout", serviceTarget()]).catch(() => {})
			if (existsSync(serviceFile())) await run(["rm", serviceFile()])
		}
		return
	}

	if (action === "uninstall") {
		await run([
			"systemctl",
			"--user",
			"disable",
			"--now",
			systemdService
		]).catch(() => {})
		if (existsSync(serviceFile())) await run(["rm", serviceFile()])
		await run(["systemctl", "--user", "daemon-reload"])
		return
	}
	await run(["systemctl", "--user", action, systemdService])
}

const showLogs = async (follow: boolean) => {
	if (platform() === "darwin") {
		await run(
			follow
				? ["tail", "-f", logPath, errorLogPath]
				: ["tail", "-n", "200", logPath, errorLogPath]
		)
		return
	}
	await run(
		follow
			? ["journalctl", "--user", "-u", systemdService, "-f"]
			: ["journalctl", "--user", "-u", systemdService, "-n", "200"]
	)
}

if (!command) {
	await startCatty({ newSession: args.includes("--new") })
} else if (command === "help") {
	printHelp()
} else if (command === "auth" && args[args.indexOf("auth") + 1] === "login") {
	const provider = args[args.indexOf("auth") + 2] ?? "openai-codex"
	if (provider !== "openai-codex")
		throw new Error(
			`Only openai-codex OAuth is wired right now: ${provider}`
		)

	const authStorage = AuthStorage.create(join(agentDir, "auth.json"))
	for (const [provider, key] of Object.entries(config.pi?.apiKeys ?? {})) {
		if (typeof key === "string") authStorage.setRuntimeApiKey(provider, key)
	}

	await authStorage.login(provider, {
		onSelect: async () => "device_code",
		onDeviceCode: (info) => {
			console.log(`Open ${info.verificationUri}`)
			console.log(`Enter code: ${info.userCode}`)
			console.log("Waiting for login to finish...")
		},
		onAuth: (info) => {
			console.log(info.instructions ?? "Open this URL to continue:")
			console.log(info.url)
		},
		onPrompt: async (prompt) => {
			console.log(prompt.message)
			for await (const chunk of Bun.stdin.stream())
				return new TextDecoder().decode(chunk).trim()
			return ""
		},
		onProgress: (message) => console.log(message)
	})
	console.log(`Logged in: ${provider}`)
} else if (command === "service") {
	const action = args[args.indexOf("service") + 1]
	if (action === "install") await installService()
	else if (action === "logs")
		await showLogs(args.includes("--follow") || args.includes("-f"))
	else if (
		["start", "stop", "restart", "status", "uninstall"].includes(action)
	)
		await runService(action)
	else printHelp()
} else {
	throw new Error(`Unknown command: ${command}`)
}
