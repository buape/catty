# Architecture

KISS target: one Discord connector, one pi session, one TOML config file.

Catty is the project/harness. The running assistant is an agent inside Catty; its name and personality live in workspace `ME.md`.

## Runtime flow

1. Load `~/.catty/config.toml` unless `--config` is passed.
2. If this is first launch, write the example config plus workspace templates, print the paths, and exit.
3. Run config migrations when the embedded config version increases.
4. Create one pi `AgentSession` for the configured workspace.
5. Start one Carbon `Client` with a `MessageCreateListener`.
6. Carbon receives Discord `MESSAGE_CREATE` events through `GatewayPlugin`.
7. Listener logs the received Discord message.
8. Listener ignores bot messages.
9. Listener checks DM users or nested guild/channel user-role whitelists.
10. Listener checks the channel response mode.
11. Accepted message text and reply context are wrapped in untrusted begin/end blocks and sent to pi.
12. Discord typing is triggered while the queued pi prompt is waiting/running.
13. Assistant text is collected from pi stream events.
14. Listener replies in Discord and logs the final response.
15. If heartbeat is enabled, the configured heartbeat file is prompted on the same queue.

## One-session rule

There is exactly one pi session object for the process. It is created at startup and reused for every accepted Discord message and heartbeat prompt.

No maps keyed by channel, user, guild, thread, or role. No session pools. No session factory inside the message listener.

## Config

The example config is written automatically on first launch, along with workspace Markdown templates. Catty exits immediately so the user can fill them out before the first real run.

Config contains a `version = 1` schema marker. `src/config.ts` has a hardcoded config version and a simple text migration table. If the code version increases, migrations run before TOML parsing and update the version line.

Full config reference lives in `docs/config.md`.

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

If a message arrives while pi is already working, use a simple in-process queue so Discord messages and heartbeat prompts are processed one at a time. This preserves one coherent conversation.

## Carbon integration

Use Carbon-native pieces:

- `Client`
- `MessageCreateListener`
- `GatewayPlugin` for message events
- `GatewayIntents.Guilds | GatewayIntents.GuildMessages | GatewayIntents.MessageContent`
- `createServer` from `@buape/carbon/adapters/bun` for HTTP routes

Keep command handling minimal. The assistant is message-first, not slash-command-first.

Catty uses Discord typing indicators instead of sending a temporary `Thinking…` message.

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
