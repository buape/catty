# Architecture

KISS target: one Discord connector, one pi session, one TOML config file.

Catty is the project/harness. The running assistant is an agent inside Catty; its name and personality live in workspace `ME.md`.

## Runtime flow

1. Load `~/.catty/config.toml` unless `--config` is passed.
2. Create `~/.catty/workspace` and template files on first launch.
3. Create one pi `AgentSession` for the configured workspace.
4. Start one Carbon `Client` with a `MessageCreateListener`.
5. Carbon receives Discord `MESSAGE_CREATE` events through the Gateway plugin.
6. Listener ignores bot messages.
7. Listener checks DM users or nested guild/channel user-role whitelists.
8. Listener checks the channel response mode.
9. Accepted message text goes to the one pi session.
10. Assistant text is collected from pi stream events.
11. Listener replies in Discord.

## One-session rule

There is exactly one pi session object for the process. It is created at startup and reused for every accepted Discord message.

No maps keyed by channel, user, guild, thread, or role. No session pools. No session factory inside the message listener.

## Config

Minimal config is written automatically on first launch. Full config reference lives in `docs/config.md`.

## Prompting

Catty's harness prompt is embedded in `src/prompt.ts`. End-user agent identity files live in the workspace:

- `AGENTS.md`
- `USER.md`
- `ME.md`
- `.pi/skills/`
- `.pi/extensions/`

## pi integration

Use the SDK:

- `DefaultResourceLoader({ cwd: workspace, agentDir, systemPromptOverride })`
- `SessionManager.create(workspace)`
- `createAgentSession({ cwd: workspace, resourceLoader, sessionManager })`

Keep the bridge minimal. Subscribe during a prompt, collect `text_delta`, unsubscribe after the prompt completes, then reply.

If a message arrives while pi is already working, use a simple in-process queue so Discord messages are processed one at a time. This preserves one coherent conversation.

## Carbon integration

Use Carbon-native pieces:

- `Client`
- `MessageCreateListener`
- `ShardingPlugin`/Gateway support for message events
- `GatewayIntents.Guilds | GatewayIntents.GuildMessages | GatewayIntents.MessageContent`
- `createServer` from `@buape/carbon/adapters/bun` for HTTP routes

Keep command handling minimal. The assistant is message-first, not slash-command-first.

## Binary and services

Development:

```bash
bun run start
```

Binary:

```bash
bun run build:binary
./dist/catty
```

macOS launchd runs the binary with `~/.catty/config.toml`.

Linux systemd runs the same binary with `/etc/catty/config.toml`.
