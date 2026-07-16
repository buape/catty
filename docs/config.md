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
- `skills/`
- `.pi/extensions/`

## Minimal required config

```toml
[discord]
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
# users = ["dm-user-id"]

# [auth.guilds."guild-id"]
# users = ["guild-user-id"]
# roles = ["guild-role-id"]

# [auth.guilds."guild-id".channels."channel-id"]
# users = ["channel-user-id"]
# roles = ["channel-role-id"]

[responses]
# default = "all"
# prefix = "!catty"

# [responses.channels]
# channel-id = "mention-or-reply"

[heartbeat]
# Required to turn heartbeat on. Default: false.
# enabled = true
# file = "HEARTBEAT.md"
# intervalMinutes = 60

# DO NOT CHANGE THIS VALUE
version = 3
```

## Required fields

- `discord.token`

`version` is Catty's config schema version. Do not edit it manually; Catty updates it when migrations run.

Heartbeat is disabled unless `heartbeat.enabled = true` is present in config.

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
- Heartbeat enabled: `false`
- Heartbeat file: `HEARTBEAT.md`
- Heartbeat interval: `60` minutes

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

`auth.users` is for DMs only.

Guild auth is nested by guild ID. Users and roles can be allowed at the guild level or narrowed inside a guild channel.

Semantics:

- `auth.users` omitted: anyone may DM the agent.
- `auth.users = []`: nobody may DM the agent.
- `auth.users = ["id"]`: only listed users may DM the agent.
- `auth.guilds` omitted: guild messages are unrestricted by guild/channel/user/role auth.
- `auth.guilds` present but empty: no guild messages are allowed.
- `auth.guilds.{guildId}` present: that guild is allowed; missing guild IDs are denied.
- guild `users`/`roles` omitted: anyone in that guild passes the guild principal check.
- guild `users`/`roles` present: matching a listed user or listed role passes the guild principal check.
- guild `channels` omitted: any channel in that guild is allowed.
- guild `channels` present but empty: no channels in that guild are allowed.
- `channels.{channelId}` present: that channel is allowed; missing channel IDs are denied.
- channel `users`/`roles` omitted: anyone passing the guild check may use that channel.
- channel `users`/`roles` present: matching a listed user or listed role passes the channel principal check.

Empty `users` or `roles` arrays match nobody for that array. If both users and roles exist at the same scope, matching either one passes that scope.

## Response modes

- `all`: respond to every allowed message.
- `mention-or-reply`: respond only if the bot is mentioned or the message replies to the bot.
- `prefix`: respond only when the message starts with the configured prefix.

In `mention-or-reply` mode, direct mention pings include the previous 10 channel messages as untrusted context when the previous channel message was not from Catty.

## Channel sessions

By default, all Discord channels share one persistent main pi session and one queue. To allow different channels to run simultaneously, opt in to per-channel sessions:

```toml
[pi]
channelSessions = true
```

When enabled, each Discord channel gets its own persistent pi session under Catty's internal workspace state. Messages and reaction context from the same channel are still queued in order for that channel.

## Heartbeat

Heartbeat is an optional hourly-style prompt from a workspace file. By default it uses a dedicated separate in-memory pi session so maintenance chatter does not pollute or get resumed as the Discord conversation session. Set `session = "main"` to run heartbeat prompts through the main Discord session queue instead.

```toml
[heartbeat]
enabled = true
# file = "HEARTBEAT.md"
# intervalMinutes = 60
# session = "separate"
```

When enabled, Catty reads the configured file relative to the workspace, skips missing/empty files, and logs the exact heartbeat prompt and final pi response.

## Memory

Catty always uses one canonical memory file:

```text
~/.catty/workspace/MEMORY.qmd
```

Catty creates it automatically as an empty file when missing and loads it into pi as a native context file. There is no memory-path setting. Durable user context, preferences, reusable notes, and agent personality belong in `MEMORY.qmd`; workspace operating rules belong in `AGENTS.md`.

Catty also exposes a built-in `memory` tool backed by QMD (`@tobilu/qmd`). The tool indexes `MEMORY.qmd` into workspace `.internal/qmd.sqlite`, updates the QMD index before recall, and supports search, hybrid query, get, append, update, status, and embed actions. Catty predownloads the QMD query-expansion and embedding models at startup so the first Discord memory query does not block on model downloads.

On upgrade, Catty may stage root workspace Markdown files and migration artifacts under `_migrated/`, then queue a post-migration agent prompt in `.internal/post-migration-prompts.jsonl`. On the next startup phase Catty runs that prompt in a separate in-memory side session so durable memory is organized into clean `MEMORY.qmd` content without condensation or information loss.
