# Config

Default path:

```text
~/.catty/config.toml
```

Catty writes a minimal config on first launch. It only includes required Discord fields. Add optional sections when you need them.

## Minimal first-launch config

```toml
[discord]
baseUrl = "http://localhost:3000"
clientId = "your-discord-application-id"
publicKey = "your-discord-public-key"
token = "your-discord-bot-token"
```

## Full config reference

```toml
[discord]
baseUrl = "http://localhost:3000"
clientId = "your-discord-application-id"
publicKey = "your-discord-public-key"
token = "your-discord-bot-token"
deploySecret = "change-me"
port = 3000
totalShards = 1

[pi]
workspace = "~/.catty/workspace"
agentDir = "~/.pi/agent"
provider = "openai-codex"
model = "gpt-5.5"
thinking = "medium"

[pi.apiKeys]
openai = "optional-openai-api-key"
ollama-cloud = "optional-ollama-cloud-key-if-your-models-json-provider-uses-this-name"

[auth]
users = ["dm-user-id"]

[auth.guilds."guild-id"]
users = ["guild-user-id"]
roles = ["guild-role-id"]

[auth.guilds."guild-id".channels."channel-id"]
users = ["channel-user-id"]
roles = ["channel-role-id"]

[responses]
default = "all"
prefix = "!catty"

[responses.channels]
channel-id = "mention-or-reply"
```

## Required fields

- `discord.baseUrl`
- `discord.clientId`
- `discord.publicKey`
- `discord.token`

## Defaults

- Config path: `~/.catty/config.toml`
- Workspace: `~/.catty/workspace`
- HTTP port: `3000`
- Response mode: `all`
- Prefix mode prefix: `!catty`
- Shards: `1`

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
