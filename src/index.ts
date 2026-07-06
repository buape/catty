import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { homedir, platform, userInfo } from "node:os"
import { dirname, join } from "node:path"
import { AuthStorage, getAgentDir } from "@earendil-works/pi-coding-agent"
import { startCatty } from "./agent"
import { config, configPath, workspace } from "./config"

const agentDir = String(config.pi?.agentDir ?? getAgentDir()).replace(
	/^~(?=$|\/)/,
	homedir()
)
const serviceLabel = "com.catty.agent"
const logDir = join(homedir(), "Library/Logs/catty")
const logPath = join(logDir, "catty.log")
const errorLogPath = join(logDir, "catty.error.log")

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

const serviceFile = () =>
	platform() === "darwin"
		? join(homedir(), "Library/LaunchAgents/com.catty.agent.plist")
		: join(homedir(), ".config/systemd/user/catty.service")

const serviceTarget = () => `gui/${userInfo().uid}/${serviceLabel}`

const printHelp = () => {
	console.log(`Catty

Usage:
  catty                         Start Catty in the foreground
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
`)
}

const installService = async () => {
	mkdirSync(dirname(serviceFile()), { recursive: true })
	mkdirSync(logDir, { recursive: true })

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
    <string>${cattyBin()}</string>
    <string>--config</string>
    <string>${configPath}</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${workspace}</string>

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
		await run(["launchctl", "bootstrap", `gui/${userInfo().uid}`, serviceFile()]).catch(
			() => {}
		)
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
WorkingDirectory=${workspace}
ExecStart=${cattyBin()} --config ${configPath}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`
	)
	await run(["systemctl", "--user", "daemon-reload"])
	await run(["systemctl", "--user", "enable", "catty.service"])
	console.log(`Installed ${serviceFile()}`)
}

const runService = async (action: string) => {
	if (platform() === "darwin") {
		if (action === "start") await run(["launchctl", "kickstart", "-k", serviceTarget()])
		if (action === "stop") await run(["launchctl", "bootout", serviceTarget()])
		if (action === "restart") {
			await run(["launchctl", "bootout", serviceTarget()]).catch(() => {})
			await run(["launchctl", "bootstrap", `gui/${userInfo().uid}`, serviceFile()])
			await run(["launchctl", "kickstart", "-k", serviceTarget()])
		}
		if (action === "status") await run(["launchctl", "print", serviceTarget()])
		if (action === "uninstall") {
			await run(["launchctl", "bootout", serviceTarget()]).catch(() => {})
			if (existsSync(serviceFile())) await run(["rm", serviceFile()])
		}
		return
	}

	if (action === "uninstall") {
		await run(["systemctl", "--user", "disable", "--now", "catty.service"]).catch(() => {})
		if (existsSync(serviceFile())) await run(["rm", serviceFile()])
		await run(["systemctl", "--user", "daemon-reload"])
		return
	}
	await run(["systemctl", "--user", action, "catty.service"])
}

const showLogs = async (follow: boolean) => {
	if (platform() === "darwin") {
		await run(follow ? ["tail", "-f", logPath, errorLogPath] : ["tail", "-n", "200", logPath, errorLogPath])
		return
	}
	await run(follow ? ["journalctl", "--user", "-u", "catty.service", "-f"] : ["journalctl", "--user", "-u", "catty.service", "-n", "200"])
}

const args = Bun.argv.slice(2)
const command = args.find((arg) => !arg.startsWith("--"))

if (!command) {
	await startCatty()
} else if (command === "help" || command === "--help" || command === "-h") {
	printHelp()
} else if (command === "auth" && args[args.indexOf("auth") + 1] === "login") {
	const provider = args[args.indexOf("auth") + 2] ?? "openai-codex"
	if (provider !== "openai-codex")
		throw new Error(`Only openai-codex OAuth is wired right now: ${provider}`)

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
	else if (action === "logs") await showLogs(args.includes("--follow") || args.includes("-f"))
	else if (["start", "stop", "restart", "status", "uninstall"].includes(action))
		await runService(action)
	else printHelp()
} else {
	throw new Error(`Unknown command: ${command}`)
}
