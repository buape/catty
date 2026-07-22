# Architecture

KISS target: one Discord connector, one default pi session mode, one TOML config file.

Catty is the project/harness. The running assistant is an agent inside Catty; durable memory, user context, name, and personality live in workspace `MEMORY.qmd`.

## Runtime flow

1. Load `~/.catty/config.toml` unless `--config` is passed.
2. If this is first launch, write the example config plus workspace `AGENTS.md`, `MEMORY.qmd`, and `.gitignore`, print the paths, and exit.
3. Run config migrations when the embedded config version increases.
4. Queue any post-migration agent prompts in workspace `.internal/post-migration-prompts.jsonl`.
5. Register the QMD-backed memory tool and run queued post-migration prompts in a separate in-memory pi side session.
6. Reload workspace resources after successful post-migration prompts.
7. Create the main pi `AgentSession` for the configured workspace, resuming the latest session unless `--new` is passed.
8. Register custom Discord and QMD-backed memory tools.
9. If `[pi].channelSessions = true`, lazily create one persistent pi session and queue per Discord channel as messages arrive.
10. Start one Carbon `Client` with a `MessageCreateListener`.
11. Carbon receives Discord `MESSAGE_CREATE` events through `GatewayPlugin`.
12. Listener logs the received Discord message.
13. Listener ignores bot messages.
14. Listener checks the global user allowlist or nested guild/channel user-role overrides.
15. Listener checks the channel response mode.
16. Accepted message text and reply context are wrapped in untrusted begin/end blocks and sent to pi.
17. Pi can use the `memory` tool to search/retrieve/update `MEMORY.qmd` through QMD.
18. Discord typing is triggered while the queued pi prompt is waiting/running.
19. Assistant text is collected from pi stream events.
20. Listener replies in Discord and logs the final response.
21. If heartbeat is enabled, the configured heartbeat file is prompted on the dedicated heartbeat session by default, or on the main queue when `[heartbeat].session = "main"`.

## Session modes

By default there is exactly one main pi session object for Discord runtime. It is created at startup and reused for every accepted Discord message. This resumes the latest workspace session; `--new` forces a fresh session object.

Set `[pi].channelSessions = true` to opt in to one persistent pi session and one queue per Discord channel. Channel sessions are created lazily under workspace internal state, so messages in different channels can run simultaneously while messages in the same channel stay ordered.

Maintenance prompts are deliberate exceptions so they do not pollute resumed Discord conversation history: heartbeat uses a separate in-memory session by default, and post-migration prompts run before the main session starts in a separate in-memory side session. Set `[heartbeat].session = "main"` to put heartbeat back on the main queue.

## Config

The example config is written automatically on first launch, along with `AGENTS.md`, `.gitignore`, and the canonical workspace `MEMORY.qmd`. Catty exits immediately so the user can fill them out before the first real run.

Config contains a `version = 3` schema marker. `src/config.ts` has a hardcoded config version and a simple text migration table. If the code version increases, migrations run before TOML parsing and update the version line.

Full config reference lives in `docs/config.md`.

## Post-migration agent prompts

Migrations that need semantic cleanup can call `queuePostMigrationPrompt(title, prompt)` from `src/config.ts`. Catty stores prompts as JSONL in workspace `.internal/post-migration-prompts.jsonl`.

On startup, after resources and the memory tool are available but before the main/resumed Discord session is created, Catty drains the queue in a separate `SessionManager.inMemory(workspace)` side session. If every prompt succeeds, Catty clears the queue and reloads workspace resources so the main session sees any file edits. If the side session fails, the queue remains for retry on the next launch.

Memory migrations can use this to ask a side agent to read files staged under `_migrated/` and organize their durable facts into clean `MEMORY.qmd` content without condensation or information loss.

## Prompting

Catty's harness prompt is embedded in `src/prompt.ts`. End-user memory and resources live in the workspace:

- `AGENTS.md`
- `MEMORY.qmd`
- `skills/`
- `.pi/extensions/`

## pi integration

Use the SDK:

- `DefaultResourceLoader({ cwd: workspace, agentDir, systemPromptOverride, agentsFilesOverride })`
- `SessionManager.continueRecent(workspace)` by default, or `SessionManager.create(workspace)` with `--new`
- `createAgentSession({ cwd: workspace, resourceLoader, sessionManager, customTools })`
- `@tobilu/qmd` `createStore({ dbPath, config })` for the built-in memory tool

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
