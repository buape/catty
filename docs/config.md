# Config

Default path:

```text
~/.catty/config.toml
```

On first launch, Catty writes `~/.catty/config.toml` from `docs/templates/config.toml`, creates the workspace Markdown templates, prints the created paths, then exits. Fill out the files and restart Catty.

First-launch workspace files:

- `AGENTS.md`
- `USER.md`
- `ME.md`
- `skills/`
- `.pi/extensions/`

## Minimal required config

```toml
[discord]
token = "your-discord-bot-token"
```

## Full config reference

```toml
[discord]
token = "your-discord-bot-token"

[pi]
# workspace = "~/.catty/workspace"
# agentDir = "~/.pi/agent"
# provider = "openai-codex"
# model = "gpt-5.5"
# thinking = "medium"

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
version = 1
```

## Required fields

- `discord.token`

`version` is Catty's config schema version. Do not edit it manually; Catty updates it when migrations run.

Heartbeat is disabled unless `heartbeat.enabled = true` is present in config.

Removed/non-configurable values:

- `discord.baseUrl` is not configurable. Carbon uses `http://localhost`.
- `discord.clientId` is not configurable. Carbon derives it from the bot token.
- `discord.publicKey` is not configurable. Carbon fetches it when needed.
- `discord.port` is not configurable. The Bun server listens on `3000`.
- `discord.deploySecret` is not used because the deploy route is disabled.
- `discord.totalShards` is not used because Catty uses Carbon's `GatewayPlugin`, not `ShardingPlugin`.

## Defaults

- Config path: `~/.catty/config.toml`
- Workspace: `~/.catty/workspace`
- Carbon base URL: `http://localhost`
- HTTP port: `3000` (not configurable)
- Response mode: `all`
- Prefix mode prefix: `!catty`
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

## Heartbeat

Heartbeat is an optional hourly-style prompt from a workspace file. It uses the same single pi session and the same in-process queue as Discord messages.

```toml
[heartbeat]
enabled = true
# file = "HEARTBEAT.md"
# intervalMinutes = 60
```

When enabled, Catty reads the configured file relative to the workspace, skips missing/empty files, and logs the exact heartbeat prompt and final pi response.
