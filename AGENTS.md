# Agent Instructions

KISS above everything else.

- Simple code first.
- Inline trivial logic.
- Let TypeScript infer types unless an exported/reused shape needs a name.
- No random helper functions, standalone types, or interfaces.
- No framework hacks. Use pi the pi way and Carbon the Carbon way.
- One assistant, one pi session. Never create per-channel, per-user, or per-guild pi sessions.
- Runtime config lives in one config file. Secrets can live there too.
- Auth rules:
  - top-level `auth.users` is for DMs only
  - guild auth lives under `auth.guilds[guildId]`
  - guild/channel scopes can contain `users` and `roles`
  - missing whitelist = anyone passes that scope
  - empty whitelist = nobody passes that array
  - non-empty whitelist = only listed IDs pass
- macOS is first-class for long-running service support. Linux/systemd is secondary.
- Bun for runtime, scripts, dependency management, and binary builds.
- Preserve user secrets and local config.

Repo files:

- `AGENTS.md`: project and harness guidance for Catty development.
- `src/prompt.ts`: embedded Catty harness system prompt.
- `docs/templates/`: first-launch workspace file templates.

End-user workspace files, created under `~/.catty/workspace` by default:

- `AGENTS.md`: workspace guidance.
- `MEMORY.qmd`: primary user context, agent name/personality, and durable memory.
- `skills/` and `.pi/extensions/`: reusable capabilities.
