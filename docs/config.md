# Config

Default path:

```text
~/.catty/config.toml
```

CLI options:

- `--config PATH` — use a custom config path.
- `--name NAME` — use a named agent namespace. Without `--config`, config lives at `~/.catty/NAME/config.toml` and workspace at `~/.catty/NAME/workspace`. Services/logs are named separately too. Catty does not allow mixing the unnamed root `~/.catty/config.toml` / `~/.catty/workspace` layout with named default-layout agents; explicit `--config` plus explicit `pi.workspace` can opt out of the default layout.
- `--dev` — when installing a service, generate it to run `bun start -- ...` from `~/Developer/catty` instead of the installed Catty binary.
- `--new` — start a fresh pi session instead of resuming the latest workspace session.

On first launch, Catty writes `~/.catty/config.toml` from `docs/templates/config.toml`, creates an empty workspace QMD memory file and native pi workspace directories, prints the created paths, then exits. Fill out the config and restart Catty.

First-launch workspace files:

- `AGENTS.md`
- `MEMORY.qmd`
- `.gitignore`
- `jobs/`
- `skills/`
- `.pi/extensions/`

## Minimal required config

```toml
token = "your-discord-bot-token"
```

## Full config reference

```toml
token = "your-discord-bot-token"
verbose = false
# Use a unique port per named service running at the same time.
# port = 7990

[pi]
# workspace = "~/.catty/workspace"
# agentDir = "~/.pi/agent"
# provider = "openai-codex"
# model = "gpt-5.5"
# thinking = "medium"
# channelSessions = false

[pi.apiKeys]
# openai = "optional-openai-api-key"
# ollama-cloud = "optional-ollama-cloud-key-if-your-models-json-provider-uses-this-name"

[auth]
# users = ["user-id"]

# [auth.guilds."guild-id"]
# users = ["guild-user-id"]
# roles = ["guild-role-id"]

# [auth.guilds."guild-id".channels."channel-id"]
# users = ["channel-user-id"]
# roles = ["channel-role-id"]

[responses]
# Default guild mode. DMs always use all.
# default = "all"
# prefix = "!catty"

# Guild channel overrides.
# [responses.channels]
# channel-id = "mention-or-reply"

# [responses.guilds."guild-id"]
# default = "mention-or-reply"

# [responses.guilds."guild-id".channels."channel-id"]
# mode = "mention-or-reply"

[jobs]
# Discover and run workspace jobs from workspace/jobs/<job-id>/. Default: true.
# enabled = true
# Seconds between scheduler scans. Default: 30.
# pollSeconds = 30
# Max stdout/stderr bytes captured per deterministic script. Default: 200000.
# maxOutputBytes = 200000

# DO NOT CHANGE THIS VALUE
version = 5
```

## Required fields

- `token`

`version` is Catty's config schema version. Do not edit it manually; Catty updates it when migrations run.

Legacy `[heartbeat]` config is still read only for one-time migration into `workspace/jobs/heartbeat/`. New configs should use workspace jobs instead.

Removed/non-configurable values:

- `discord.baseUrl` is not configurable. Carbon uses `http://localhost`.
- `discord.clientId` is not configurable. Catty fetches the app ID from Discord using the bot token.
- `discord.publicKey` is not configurable. Catty fetches the public key from Discord using the bot token.
- `discord.port` is not used. Use top-level `port` instead.
- `discord.deploySecret` is not used because the deploy route is disabled.
- `discord.totalShards` is not used because Catty uses Carbon's `GatewayPlugin`, not `ShardingPlugin`.

## Defaults

- Config path: `~/.catty/config.toml`
- Workspace: `~/.catty/workspace`
- Memory file: `~/.catty/workspace/MEMORY.qmd`
- Internal workspace state: `~/.catty/workspace/.internal/`
- Named config path: `~/.catty/NAME/config.toml`
- Named workspace: `~/.catty/NAME/workspace`
- If named agents exist and no unnamed root agent exists, running without `--name`/`--config` prints help instead of creating `~/.catty/config.toml`.
- Carbon base URL: `http://localhost`
- HTTP port: `7990`
- Response mode: `all`
- Prefix mode prefix: `!catty`
- Channel sessions: `false` (all Discord channels share one main pi session)
- Jobs enabled: `true`
- Jobs directory: `~/.catty/workspace/jobs/`
- Jobs poll interval: `30` seconds
- Jobs SQLite state: `~/.catty/workspace/.internal/jobs.sqlite`

## Providers

Primary expected providers:

- GPT subscription: run Catty's auth command for ChatGPT/Codex, then set `pi.provider = "openai-codex"` and `pi.model = "gpt-5.5"` if you want to pin it.
- GPT API key: set `pi.apiKeys.openai`, or use normal pi auth/env vars.
- Ollama Cloud: define the provider in pi `models.json`, then put its key under `pi.apiKeys` using that provider name.

### GPT subscription OAuth

Catty wraps pi's OAuth storage so users do not need to open pi.

```bash
catty auth login
```

From source:

```bash
bun run start -- auth login
```

This uses OpenAI Codex device-code login. Catty prints a URL and code, waits for completion, and stores the OAuth credential in `~/.pi/agent/auth.json` by default.

Catty will use that credential when either:

```toml
[pi]
provider = "openai-codex"
model = "gpt-5.5"
```

or when pi's normal settings select that provider/model.

For launchd/systemd, run `catty auth login` as the same OS user that runs Catty. If you use a custom auth dir, set `pi.agentDir` in `~/.catty/config.toml` to that same pi agent dir.

## Auth

`auth.users` is the global user allowlist. It applies to DMs and to guilds that do not have a more specific `auth.guilds.{guildId}` override.

Guild auth is nested by guild ID. Users and roles can be allowed at the guild level or narrowed inside a guild channel. A configured guild overrides the global `auth.users` default for that guild.

Semantics:

- `auth.users` omitted: anyone may use the agent by default.
- `auth.users = []`: nobody may use the agent by default.
- `auth.users = ["id"]`: only listed users may use the agent by default.
- `auth.guilds` omitted or empty: guild messages follow `auth.users`.
- `auth.guilds.{guildId}` present: that guild uses its specific guild/channel rules instead of `auth.users`.
- missing guild IDs: guild messages follow `auth.users`.
- guild `users`/`roles` omitted: anyone in that guild passes the guild principal check.
- guild `users`/`roles` present: matching a listed user or listed role passes the guild principal check.
- guild `channels` omitted: any channel in that guild is allowed.
- guild `channels` present but empty: no channels in that guild are allowed.
- `channels.{channelId}` present: that channel is allowed; missing channel IDs are denied.
- channel `users`/`roles` omitted: anyone passing the guild check may use that channel.
- channel `users`/`roles` present: matching a listed user or listed role passes the channel principal check.

Empty `users` or `roles` arrays match nobody for that array. If both users and roles exist at the same scope, matching either one passes that scope.

## Response modes

Response modes apply to guild messages. DMs always use `all`.

- `all`: respond to every allowed message.
- `mention-or-reply`: respond only if the bot is mentioned or the message replies to the bot.
- `prefix`: respond only when the message starts with the configured prefix.

Guild response mode precedence is:

1. `responses.guilds.{guildId}.channels.{channelId}.mode`
2. `responses.channels.{channelId}`
3. `responses.guilds.{guildId}.default`
4. `responses.default`
5. `all`

In `mention-or-reply` mode, direct mention pings include the previous 10 channel messages as untrusted context when the previous channel message was not from Catty.

## Channel sessions

By default, all Discord channels share one persistent main pi session and one queue. To allow different channels to run simultaneously, opt in to per-channel sessions:

```toml
[pi]
channelSessions = true
```

When enabled, each Discord channel gets its own persistent pi session under Catty's internal workspace state. Messages and reaction context from the same channel are still queued in order for that channel.

## Jobs

Catty discovers scheduled workspace jobs under:

```text
~/.catty/workspace/jobs/<job-id>/
```

Each job has `prompt.md`, `meta.toml`, and optional deterministic scripts. Jobs support repeating cron schedules, fixed intervals, and one-off `at` schedules. Pre-check scripts can return `{ "run": false }` to skip pi entirely before model usage.

Global scheduler settings are optional:

```toml
[jobs]
# enabled = true
# pollSeconds = 30
# maxOutputBytes = 200000
```

A small recurring job:

```toml
# ~/.catty/workspace/jobs/hourly-maintenance/meta.toml
enabled = true
session = "separate"
priority = "low"

[schedule]
type = "cron"
expr = "0 * * * *"
timezone = "America/New_York"
```

A one-off job:

```toml
# ~/.catty/workspace/jobs/domain-renewal/meta.toml
enabled = true
session = "separate"
priority = "low"

[schedule]
type = "at"
at = "2026-02-01T15:00:00-05:00"
```

See `docs/jobs.md` for the full `meta.toml` contract, deterministic script contracts, examples, troubleshooting, and heartbeat migration details.

## Legacy heartbeat migration

Legacy `[heartbeat]` config is no longer the runtime scheduler. On startup, if `[heartbeat].enabled = true` and the heartbeat file exists with content, Catty copies that content into `jobs/heartbeat/prompt.md`, writes an interval `meta.toml` matching `intervalMinutes`, leaves the original `HEARTBEAT.md` untouched, and records `.internal/heartbeat-job-migration.json` so it does not duplicate the job.

## Memory

Catty always uses one canonical memory file:

```text
~/.catty/workspace/MEMORY.qmd
```

Catty creates it automatically as an empty file when missing and loads it into pi as a native context file. There is no memory-path setting. Durable user context, preferences, reusable notes, and agent personality belong in `MEMORY.qmd`; workspace operating rules belong in `AGENTS.md`.

Catty also exposes a built-in `memory` tool backed by QMD (`@tobilu/qmd`). The tool indexes `MEMORY.qmd` into workspace `.internal/qmd.sqlite`, updates the QMD index before recall, and supports search, hybrid query, get, append, update, status, and embed actions. Catty predownloads the QMD query-expansion and embedding models at startup so the first Discord memory query does not block on model downloads.

On upgrade, Catty may stage root workspace Markdown files and migration artifacts under `_migrated/`, then queue a post-migration agent prompt in `.internal/post-migration-prompts.jsonl`. On the next startup phase Catty runs that prompt in a separate in-memory side session so durable memory is organized into clean `MEMORY.qmd` content without condensation or information loss.
