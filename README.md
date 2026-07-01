# Catty

KISS personal assistant agent harness for Discord.

Catty is the project/harness. The actual agent name and personality live in the end-user workspace `ME.md`.

## Install

```bash
brew install buape/tap/catty
```

## First launch

Run Catty once to create the default config and workspace templates:

```bash
catty
```

Defaults:

- Config: `~/.catty/config.toml`
- Workspace: `~/.catty/workspace`
- Agent runtime: one shared pi session
- Discord connector: Carbon

Edit the generated config:

```bash
code ~/.catty/config.toml
```

At minimum, fill in the required Discord values:

```toml
[discord]
baseUrl = "http://localhost:3000"
clientId = "your-discord-application-id"
publicKey = "your-discord-public-key"
token = "your-discord-bot-token"
```

Full config reference: [`docs/config.md`](docs/config.md)

## GPT subscription OAuth

Catty wraps pi's ChatGPT/Codex OAuth flow, so users do not need to open pi directly.

```bash
catty auth login
```

Follow the printed device-code instructions. Credentials are stored in pi's normal auth store, usually:

```text
~/.pi/agent/auth.json
```

For launchd/systemd, run `catty auth login` as the same OS user that runs the service.

## Run

```bash
catty
```

Custom config path:

```bash
catty --config /path/to/config.toml
```

## Workspace files

Created under `~/.catty/workspace` by default:

- `AGENTS.md` — workspace guidance.
- `USER.md` — primary user context.
- `ME.md` — agent name and personality.
- `.pi/skills/` — pi skills.
- `.pi/extensions/` — pi extensions.

Catty's own harness system prompt is embedded in code at `src/prompt.ts`.

## Services

Templates:

- macOS launchd: `services/com.catty.agent.plist`
- Linux systemd: `services/catty.service`

The macOS template assumes the Homebrew binary path and `~/.catty/config.toml`. Edit paths before installing it.

## Development

For local development from source:

```bash
bun install
bun run typecheck
bun run lint
bun run build
bun run build:binary
```

GitHub releases and Homebrew tap publishing are tag-driven. See [`docs/releases.md`](docs/releases.md).
