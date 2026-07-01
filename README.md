# Catty

KISS personal assistant agent harness for Discord.

Catty is the project/harness. The actual agent name and personality live in the end-user workspace `ME.md`.

## Defaults

- Config: `~/.catty/config.toml`
- Workspace: `~/.catty/workspace`
- First launch writes minimal config + workspace templates.
- Runtime: Bun
- Discord connector: Carbon
- Agent runtime: one shared pi session

## Install

```bash
bun install
```

## Configure

Start once to write the minimal config:

```bash
bun run start
```

Edit:

```bash
~/.catty/config.toml
```

Full config reference: [`docs/config.md`](docs/config.md)

## GPT subscription OAuth without opening pi

```bash
bun run start -- auth login
```

This uses the ChatGPT/Codex device-code OAuth flow and stores credentials in pi's normal auth store, usually:

```text
~/.pi/agent/auth.json
```

For a service, run the auth command as the same OS user that runs Catty.

## Run

```bash
bun run start
```

Custom config path:

```bash
bun run start -- --config /path/to/config.toml
```

## Build

```bash
bun run typecheck
bun run lint
bun run build
bun run build:binary
```

Release binaries locally:

```bash
bun run release
```

GitHub releases and Homebrew tap publishing are tag-driven. See [`docs/releases.md`](docs/releases.md).

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
