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

Named agent namespace:

```bash
catty --name work
```

This uses `~/.catty/work/config.toml`, `~/.catty/work/workspace`, and separate service/log names. Catty does not allow mixing unnamed root `~/.catty/config.toml` / `~/.catty/workspace` with named default-layout agents; explicit `--config` plus explicit `pi.workspace` can opt out. Manage its service with the same name flag:

```bash
catty --name work service install
catty --name work service logs --follow
catty --name work service errors --follow
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
- `.gitignore` — ignores Catty internal workspace state.
- Migration artifacts may be staged under `_migrated/`; post-migration side sessions organize durable content into `MEMORY.qmd` without condensing it.
- `jobs/` — Catty scheduled jobs. Each job lives in `jobs/<job-id>/` with `prompt.md`, `meta.toml`, and optional deterministic scripts.
- `skills/` — pi skills.
- `.pi/extensions/` — pi extensions.

Catty's own harness system prompt is embedded in code at `src/prompt.ts`.

See `docs/jobs.md` for the scheduled job folder contract, deterministic script contracts, examples, and heartbeat migration behavior.

## Runtime behavior

- By default, one Catty process uses one shared pi session.
- On startup, Catty resumes the most recent pi session for the workspace, or creates one if none exists. Pass `--new` to force a fresh pi session.
- Discord messages are queued through that one session by default. Set `[pi].channelSessions = true` to give each Discord channel its own persistent pi session and queue so channels can run simultaneously.
- Reply context is included when a Discord message replies to another message.
- User-provided Discord content is wrapped in per-message untrusted begin/end blocks before pi sees it.
- Catty uses Discord typing indicators while pi is working instead of sending `Thinking…`.
- Verbose logs show received Discord messages, the exact prompt sent to pi, pi status/events, and final responses.
- Catty discovers scheduled jobs from `workspace/jobs/<job-id>/meta.toml`. Jobs support cron, interval, and one-off schedules; deterministic checks can skip pi entirely when there is no work; context scripts feed stable input into the prompt; `prompt.md` directs agent-run job scripts through normal tools. One-off job folders are deleted after a run by default, or archived under `jobs/_archive/` with `jobs.oneOffCleanup = "archive"`.
- Legacy `[heartbeat]` config is migrated once into a normal `jobs/heartbeat/` folder while preserving `HEARTBEAT.md`.
- The built-in `memory` tool uses QMD to update/search/get/append/embed `MEMORY.qmd`; its local SQLite index lives at `.internal/qmd.sqlite` inside the workspace. Job runtime state lives at `.internal/jobs.sqlite`. QMD query-expansion and embedding models are predownloaded at startup.

## Services

Templates:

- macOS launchd: `services/com.catty.agent.plist`
- Linux systemd: `services/catty.service`

The macOS template assumes the Homebrew binary path and `~/.catty/config.toml`. Edit paths before installing it. For multiple service agents, install/manage each one with `catty --name NAME service ...`.

For development services, pass `--dev` while installing. The generated service runs `bun start -- ...` from `~/Developer/catty` instead of the installed Catty binary:

```bash
catty --dev --name work service install
```

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
