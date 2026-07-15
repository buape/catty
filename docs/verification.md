# Verification

## Commands

Passed:

```bash
bun run typecheck
bun run build
bun run build:binary
bun run release
```

Unavailable:

- no `lint` script in `package.json`
- no `test` script in `package.json`

## Binary outputs

Produced in `dist/`:

- `catty`
- `catty-darwin-arm64`
- `catty-darwin-x64`
- `catty-linux-x64`
- `index.js`

## Whitelist dry-run

Expression checked:

```js
list === undefined ? true : list.includes(id)
list === undefined ? true : list.some((id) => ids.includes(id))
```

Observed:

```json
{
  "missing": true,
  "empty": false,
  "match": true,
  "miss": false,
  "roleMissing": true,
  "roleEmpty": false,
  "roleMatch": true,
  "roleMiss": false
}
```

Matches required semantics:

- missing whitelist: unrestricted
- empty whitelist: no one allowed
- non-empty whitelist: matching IDs only

## Response mode dry-run

Observed:

```json
{
  "defaultMode": "all",
  "channelOverride": "prefix"
}
```

Matches required behavior:

- default mode is `all`
- per-channel override wins
- implemented modes: `all`, `mention-or-reply`, `prefix`

## Session inspection

`src/agent.ts` creates one main Discord runtime pi session at startup. By default, the Carbon message listener reuses that `session` through one in-process queue.

When `[pi].channelSessions = true`, `src/agent.ts` lazily creates a persistent session and queue per Discord channel so different channels can run simultaneously. The default remains a single shared session.

Heartbeat uses a dedicated separate in-memory session by default unless `[heartbeat].session = "main"`. Queued migration prompts run before the main session starts via `SessionManager.inMemory(workspace)`, then Catty reloads resources and creates the main session.

## KISS inspection

`src/index.ts` has:

- no standalone `type` declarations
- no standalone `interface` declarations
- no helper functions
- one Carbon listener class required by Carbon's listener API
- one necessary inline parameter type for Discord mention IDs

## Service inspection

- `services/com.catty.agent.plist` uses `ProgramArguments`, `WorkingDirectory`, `RunAtLoad`, `KeepAlive`, and log paths for macOS launchd.
- `services/catty.service` uses `WorkingDirectory`, `ExecStart`, and `Restart=on-failure` for Linux systemd.
- README documents both, with macOS first.
