# Catty jobs

Catty jobs are workspace-owned scheduled prompts. They replace the old special heartbeat runner with one skill-like folder format for recurring maintenance, deterministic checks, and one-off reminders.

```text
~/.catty/workspace/jobs/
  email-triage/
    prompt.md
    meta.toml
    scripts/
      check.ts
      context.ts
      mark-read.sh
```

- `prompt.md` is the trusted job prompt sent to pi when the job actually runs. Put agent-facing script requirements here, including which scripts under `scripts/` to use and exact commands.
- `meta.toml` is the job's declarative schedule plus deterministic pre-agent check/context script contract.
- `scripts/` is conventional. Catty runs check/context scripts from `meta.toml` before the agent. Once the agent is running, it may use normal agent tools to run arbitrary commands; deterministic script instructions belong in `prompt.md`, not `meta.toml`.
- Runtime state never goes in the job folder. Catty stores runtime facts in `.internal/jobs.sqlite`.

## Minimal recurring job

```toml
enabled = true
session = "separate"
priority = "low"

[schedule]
type = "cron"
expr = "0 * * * *"
timezone = "America/New_York"
```

## Minimal one-off job

```toml
enabled = true
session = "separate"
priority = "low"

[schedule]
type = "at"
at = "2026-02-01T15:00:00-05:00"
timezone = "America/New_York"
```

## Minimal interval job

```toml
enabled = true
session = "separate"
priority = "low"

[schedule]
type = "interval"
minutes = 30
```

## Fully commented job

```toml
# Whether Catty should discover and run this job. Default: true.
enabled = true

# Where the pi prompt should run.
# - "separate": shared in-memory maintenance session; does not pollute Discord chat history.
# - "main": same main session and queue as normal Discord messages.
# Default: separate.
session = "separate"

# Queue priority.
# - "low": Discord work can jump ahead of scheduled maintenance.
# - "normal": run in normal queue order.
# Default: low.
priority = "low"

# When Catty should wake the deterministic layer for this job.
[schedule]

# Supported values:
# - "cron": repeating five-field cron expression: minute hour day-of-month month day-of-week
# - "interval": fixed delay after the last run, e.g. every 30 minutes
# - "at": one specific ISO date/time

type = "cron"

# Cron expression. Examples:
# - "0 * * * *" every hour
# - "*/15 * * * *" every 15 minutes
# - "30 9 * * 1-5" weekdays at 09:30
expr = "*/15 * * * *"

# Timezone used by cron and at schedules when the date/time does not include an offset.
timezone = "America/New_York"

# Checks run before pi. If any check returns { "run": false }, Catty skips the model call.
[[checks]]
id = "new-email"
run = "bun scripts/check.ts"
timeoutSeconds = 30

# Context scripts run after checks pass. Their stdout is injected into the prompt.
[[context]]
id = "email-summary"
run = "bun scripts/context.ts"
format = "markdown"
timeoutSeconds = 60

# Agent-run deterministic scripts are not declared here.
# Put script instructions and exact commands in prompt.md instead.
```

## Schedule fields

### Cron

```toml
[schedule]
type = "cron"
expr = "*/15 * * * *"
timezone = "America/New_York"
```

Cron supports five fields: minute, hour, day of month, month, day of week. `*`, comma lists, ranges, and step syntax such as `*/15` are supported.

### Interval

```toml
[schedule]
type = "interval"
minutes = 30
```

Use one or more of `seconds`, `minutes`, and `hours`. The interval is measured after the last scheduled execution. New interval jobs start after their first interval, not immediately.

### At

```toml
[schedule]
type = "at"
at = "2026-02-01T15:00:00-05:00"
timezone = "America/New_York"
```

One-off `at` jobs run once. After a successful, skipped, or failed attempt is recorded, Catty marks that scheduled occurrence complete so it will not loop forever. Edit the schedule or create a new job for another one-off task.

## Deterministic script command rules

`run` commands intentionally point at files inside the job folder. Supported patterns include:

```toml
run = "bun scripts/check.ts"
run = "node scripts/check.js"
run = "bash scripts/check.sh"
run = "sh scripts/check.sh"
run = "python3 scripts/check.py"
run = "./scripts/check"
```

Catty tokenizes the command without invoking a shell, verifies the referenced script stays inside the job folder, applies a timeout, bounds stdout/stderr, and records the result in SQLite.

## Check script contract

A check script exits `0` and prints a JSON object:

```json
{ "run": true, "reason": "3 unread emails" }
```

or:

```json
{ "run": false, "reason": "no unread emails" }
```

Nonzero exit, invalid JSON, missing `run`, timeout, or oversized output is treated as a job error, not as "no work". "No work" must be explicit with `run: false`.

## Context script contract

A context script exits `0` and prints text. Catty wraps stdout into the scheduled prompt:

```md
<job_context id="email-summary" format="markdown">
...
</job_context>
```

Use `format = "markdown"`, `"json"`, or `"text"` as a hint for the agent.

## Scheduled job responses

Catty injects the scheduled-job response rule into every job run: the final assistant response is logged by Catty, and user-facing updates require an explicit communication tool call such as `discord` action `send_message`.

Job `prompt.md` files stay focused on job-specific behavior, such as the target channel and when a notification is useful.

Example `prompt.md` excerpt:

```md
If there is anything important, send a concise Discord message to channel 123456789. Otherwise finish silently.
```

## Agent-run script instructions

Do not declare agent-run action scripts in `meta.toml`. Put them in `scripts/` if convenient, then give direct instructions in `prompt.md`.

Example `prompt.md` excerpt:

```md
Deterministic script instructions:

- To mark an email as handled, run:
  `bash scripts/mark-read.sh abc123`
- To archive a thread after summarizing it, run:
  `bun scripts/archive-thread.ts thread-id`

Use these scripts when they cover the action. Use normal agent tools for work outside them.
```

Catty includes the job path and a list of files under `scripts/` in the scheduled prompt as a reminder. The descriptions and usage rules belong in `prompt.md` so humans can write plain job guidance without TOML ceremony.

Agent-run script calls are normal agent tool activity, not Catty scheduler pre-agent script runs. The scheduler records check/context scripts in `.internal/jobs.sqlite`; agent tool calls remain in the pi session transcript/logs.

## Agent-facing jobs tool

Catty gives the agent a `jobs` tool. The system prompt tells the agent to use it naturally when a human asks for reminders, one-off scheduled tasks, recurring checks, monitoring, or deterministic scheduled workflows.

Common calls:

```json
{ "action": "list" }
```

```json
{ "action": "get", "jobId": "email-triage" }
```

```json
{
  "action": "create",
  "title": "Domain renewal reminder",
  "prompt": "Remind the primary user to renew the domain. Send a concise Discord message if appropriate.",
  "schedule": {
    "type": "at",
    "at": "2026-02-01T15:00:00-05:00"
  },
  "session": "separate",
  "priority": "low"
}
```

```json
{ "action": "cancel", "jobId": "domain-renewal", "reason": "user asked to cancel" }
```

```json
{ "action": "run_now", "jobId": "email-triage" }
```

The jobs tool manages job definitions and queues job runs. During scheduled runs, command/file work happens through normal agent tools. Follow deterministic script instructions in `prompt.md` when they match the task.

The tool validates job ids, writes normal job folders for created jobs, and returns clear JSON errors for missing jobs or invalid schedules.

## SQLite runtime state

Catty stores runtime facts in:

```text
~/.catty/workspace/.internal/jobs.sqlite
```

Tables:

- `job_state`: discovered job id/path/config hash, next run, last run, last status, one-off completion, failure count.
- `runs`: each scheduled/manual execution, prompt text, final response, skip reason, status, errors.
- `script_runs`: every pre-agent check/context script execution, command, stdout/stderr, exit code, timeout/error status.

The database is disposable runtime state. Job definitions remain the source of truth.

## Troubleshooting

- Job never appears: confirm the folder is directly under `workspace/jobs/`, the folder name uses only letters/numbers/dash/underscore, and both `prompt.md` and `meta.toml` exist.
- Job appears but never runs: check `enabled`, `schedule`, and `job_state.next_run_at` in `.internal/jobs.sqlite`.
- Check skipped the model: inspect the check stdout and skip reason in the `runs` and `script_runs` tables.
- Check/context script rejected as unsafe: point `run` at a script file inside the job folder, e.g. `bun scripts/check.ts`; shell pipelines and redirects are intentionally rejected for pre-agent scripts.
- Script timed out or output was cut off: increase `timeoutSeconds` for that script or reduce stdout/stderr. The global capture limit defaults to `jobs.maxOutputBytes = 200000`.
- One-off job ran once and stopped: this is expected. Edit the `at` schedule or create a new job for another one-off run.

## Heartbeat migration

Legacy `[heartbeat]` config and `HEARTBEAT.md` are converted into a normal job folder on startup. Catty copies the heartbeat prompt into `jobs/heartbeat/prompt.md` or a safe variant if that folder already exists, writes an interval schedule matching `intervalMinutes`, and leaves the original heartbeat file untouched for preservation. A marker under `.internal/` prevents duplicate migrations.
