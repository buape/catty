# Catty

KISS personal assistant agent harness for Discord.

Catty is the project/harness. The actual durable memory, agent name, and personality live in the end-user workspace `MEMORY.qmd`.

## Install

```bash
brew install buape/tap/catty
```

## First launch

Run Catty once to create the default config and empty workspace memory file, then exit:

```bash
catty
```

Catty creates:

- Config: `~/.catty/config.toml`
- Workspace: `~/.catty/workspace`
- Workspace files: `AGENTS.md`, `MEMORY.qmd`

Fill out the generated config, then restart Catty. Memory starts empty for now.

At minimum, set the Discord bot token:

```toml
[discord]
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

Start a fresh pi session instead of resuming the latest one:

```bash
catty --new
```

## Workspace files

Created under `~/.catty/workspace` by default:

- `AGENTS.md` — workspace operating rules.
- `MEMORY.qmd` — durable user context, preferences, reusable notes, agent name, and personality; indexed by QMD for memory search/retrieval.
- Migration artifacts may be staged under `_migrated/`; post-migration side sessions organize durable content into `MEMORY.qmd` without condensing it.
- `HEARTBEAT.md` — optional heartbeat prompt source when enabled.
- `skills/` — pi skills.
- `.pi/extensions/` — pi extensions.

Catty's own harness system prompt is embedded in code at `src/prompt.ts`.

## Runtime behavior

- One Catty process uses one shared pi session.
- On startup, Catty resumes the most recent pi session for the workspace, or creates one if none exists. Pass `--new` to force a fresh pi session.
- Discord messages are queued through that one session.
- Reply context is included when a Discord message replies to another message.
- User-provided Discord content is wrapped in per-message untrusted begin/end blocks before pi sees it.
- Catty uses Discord typing indicators while pi is working instead of sending `Thinking…`.
- Verbose logs show received Discord messages, the exact prompt sent to pi, pi status/events, and final responses.
- Optional heartbeat prompts run from `HEARTBEAT.md` only when `[heartbeat].enabled = true` is set; they use a dedicated separate in-memory pi session by default unless `[heartbeat].session = "main"`.
- The built-in `memory` tool uses QMD to update/search/get/append/embed `MEMORY.qmd`; its local SQLite index lives at `.catty/qmd.sqlite` inside the workspace. QMD query-expansion and embedding models are predownloaded at startup.

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
