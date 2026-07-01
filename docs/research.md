# Research Notes

## pi

Sources reviewed:

- `/Users/shadow/.nvm/versions/node/v24.16.0/lib/node_modules/@earendil-works/pi-coding-agent/README.md`
- `docs/sdk.md`
- `docs/skills.md`
- `docs/extensions.md`
- `docs/prompt-templates.md`
- `examples/sdk/01-minimal.ts`
- `examples/sdk/03-custom-prompt.ts`
- `examples/sdk/04-skills.ts`
- `examples/sdk/06-extensions.ts`
- `examples/sdk/07-context-files.ts`
- `examples/sdk/11-sessions.ts`
- `examples/sdk/13-session-runtime.ts`

Implementation notes:

- Use the pi SDK, not a CLI subprocess, unless SDK integration proves blocked.
- `createAgentSession()` is enough for one global session.
- Use one `SessionManager` instance for the harness, not per Discord channel/user/guild.
- Use `DefaultResourceLoader` with the configured workspace `cwd` so pi discovers context files, skills, extensions, prompts, and project settings normally.
- `AGENTS.md` is loaded as a context file from cwd and ancestors.
- Project skills can live in `.pi/skills/` or `.agents/skills/`; directories containing `SKILL.md` are discovered recursively.
- Project extensions can live in `.pi/extensions/`.
- The SDK supports a full system prompt override with `DefaultResourceLoader({ systemPromptOverride })`.
- Pi's native project system prompt file is `.pi/SYSTEM.md`; Catty instead embeds its harness prompt in code and passes that through `systemPromptOverride`, while user/workspace identity comes from workspace `AGENTS.md`, `USER.md`, and `ME.md`.
- `session.prompt()` sends input and waits for the full agent run. If the session is already streaming, use `steer`, `followUp`, or `prompt(..., { streamingBehavior })`.
- Subscribe to `message_update` text deltas and accumulate assistant text for Discord replies.

## Carbon

Sources reviewed:

- `https://github.com/buape/carbon`
- `/tmp/pi-github-repos/buape/carbon/README.md`
- `/tmp/pi-github-repos/buape/carbon/packages/carbon/README.md`
- `/tmp/pi-github-repos/buape/carbon/packages/carbon/package.json`
- `/tmp/pi-github-repos/buape/carbon/apps/socketo/src/index.ts`
- `/tmp/pi-github-repos/buape/carbon/apps/socketo/src/events/messageCreate.ts`
- `/tmp/pi-github-repos/buape/carbon/apps/rocko/src/events/messageCreate.ts`
- `/tmp/pi-github-repos/buape/carbon/packages/carbon/src/classes/Client.ts`
- `/tmp/pi-github-repos/buape/carbon/packages/carbon/src/classes/Listener.ts`
- `/tmp/pi-github-repos/buape/carbon/packages/carbon/src/plugins/gateway/GatewayPlugin.ts`
- `/tmp/pi-github-repos/buape/carbon/packages/carbon/src/plugins/sharding/ShardingPlugin.ts`
- `/tmp/pi-github-repos/buape/carbon/packages/carbon/src/adapters/bun/index.ts`
- `/tmp/pi-github-repos/buape/carbon/packages/carbon/src/adapters/fetch/index.ts`
- Carbon docs search: https://carbon.buape.com/adapters/node and https://carbon.buape.com/getting-started/introduction

Implementation notes:

- Carbon is HTTP-interactions-first, but message events require Gateway support.
- Use `Client` with listeners and `ShardingPlugin`/Gateway support for `MESSAGE_CREATE`.
- For a single-machine personal assistant, use one shard by config unless Discord recommends otherwise; keep this simple.
- Gateway intents needed for normal message content: `GatewayIntents.Guilds | GatewayIntents.GuildMessages | GatewayIntents.MessageContent`. Role checks may need guild member data present in message events; if not, use payload member roles or fetch as needed.
- `MessageCreateListener` is the native Carbon listener for Discord messages.
- `Message` supports `reply(...)`, so the listener can reply to the triggering message.
- Carbon's Bun adapter exposes `createServer(client, options)` using `Bun.serve`; use it for any HTTP interaction/deploy routes rather than hand-rolling request routing.
- Carbon client requires `baseUrl`, `clientId`, `publicKey`, `token`, and `deploySecret` unless deploy route is disabled.

## Bun

Sources reviewed:

- https://bun.sh/docs/bundler/executables
- https://bun.sh/reference/bun/build
- https://bun.sh/docs/pm/cli/install
- https://bun.sh/docs/pm/lifecycle

Implementation notes:

- Use `bun add` for dependencies and `bun install` for lockfile/install.
- Use `bun build ./src/index.ts --compile --outfile dist/catty` for a local single-file executable.
- Use target-specific `bun build --compile --target ...` later if release artifacts need cross-platform builds.
- Bun does not run dependency lifecycle scripts by default; only add trusted dependencies intentionally if a package needs lifecycle scripts.

## Services

Sources reviewed:

- Apple launchd: https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html
- launchd.plist man page mirror: https://keith.github.io/xcode-man-pages/launchd.plist.5.html
- systemd service: https://www.freedesktop.org/software/systemd/man/249/systemd.service.html
- systemd exec: https://freedesktop.org/software/systemd/man/latest/systemd.exec.html

Implementation notes:

- macOS first-class: provide a LaunchAgent plist using `ProgramArguments`, `WorkingDirectory`, `KeepAlive`, `RunAtLoad`, and stdout/stderr log paths.
- Linux secondary: provide a `systemd` unit with `WorkingDirectory`, `ExecStart`, `Restart=on-failure`, and install instructions.
- Service templates should run either `bun run start -- --config ...` during development or the compiled binary long term.
