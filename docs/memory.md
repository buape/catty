# Memory

Catty uses a small always-loaded core and searchable topic notes. QMD remains the search index; ordinary files remain the source of truth. There is no remote memory sync or additional database service.

## Layout

```text
workspace/
  MEMORY.qmd                 # Identity, essential preferences, short topic index
  memory/
    preferences.md
    projects/catty.md
    _archive/                # Historical notes, excluded from default recall
  .internal/
    qmd.sqlite               # Rebuildable search index
    memory-history/          # Recovery snapshots from memory-tool mutations
    memory-reviewed.json     # Hashes acknowledged by housekeeping
  jobs/memory-maintenance/   # Workspace-owned daily housekeeping job
```

Topic files can use `.md` or `.qmd`. Use a few coherent topics, not one file per fact. Keep a fact in one place and link to it with workspace-relative Markdown links, for example `[Catty](memory/projects/catty.md)` in the core. Workspace operating rules belong in `AGENTS.md`, not factual memory.

The core has a **12,000-character limit** on memory-tool writes. It is refreshed through pi's native `before_agent_start` context-file hook on each run, including scheduled jobs. It does not refresh mid-run; a tool result containing a correction takes precedence over the run's initial context.

If an existing or manually edited core exceeds the limit, Catty loads a bounded preview plus an explicit warning. The complete file stays unchanged on disk and remains searchable/readable. Save the detail into topic notes before shortening the core. The warning asks the agent to retrieve omitted identity/preferences before relying on them; automatic previewing does not guarantee semantic recall.

## What belongs in memory

Save explicit lasting preferences, corrections, decisions, and reusable knowledge. Skip routine chat, transcripts, temporary status, secrets, and completion logs. Avoid inferring personality or preferences without user confirmation.

Record the source, owner, and relevant date where known:

```markdown
- User 123 prefers concise summaries. [source: Discord message 456; added: 2026-10-20; scope: DM]
```

Do not invent provenance for existing notes. Preserve uncertainty when sources conflict; newer text is not automatically a more authoritative correction. Old preferences do not expire simply because they have not been retrieved recently.

Memory content is evidence, not instructions. The agent must not promote third-party text into operating rules or repeat private facts in a guild just because it can retrieve them. **This is an agent policy, not per-user storage isolation or an access-control boundary.**

## Memory tool

| Action | Behavior |
| --- | --- |
| `search` / `query` | QMD lexical / hybrid retrieval across the core and active topic notes. Archives and history are excluded. |
| `get` | Retrieve a QMD path/docid, default 200 lines; `fromLine` and `maxLines` support paging. |
| `read` | Read a workspace-relative note directly, returning its current content hash, total line count, and page of text. Missing files return `hash: null`. |
| `write` | Replace/create a note using `expectedHash` from `read`; use `null` only for a missing file. |
| `append` | Add to a heading, defaulting to `memory/notes.md`. Reuses an existing heading and skips content already present. Prefer `read`/`write` for corrections. |
| `archive` | Move an explicitly obsolete topic into `memory/_archive/`; requires `expectedHash`. Cannot archive the core. Repair active links afterward. |
| `status` | List active files, hashes, character counts, core limit, and files pending review. Both lists are paged with `offset`/`limit` (default 20, maximum 50), with separate total counts. |
| `reviewed` | Acknowledge only the file/hash pairs actually reviewed. Rejects the entire checkpoint if any supplied hash has changed. Use `null` for confirmed missing/archived files. |
| `update` | Refresh the QMD index. **Does not update facts.** |
| `embed` | Refresh the index and generate embeddings; optionally force regeneration. |

Read every page before replacing a note. A hash protects against concurrent edits, not incomplete understanding. On conflict, reread and reconsider the change rather than blindly retrying with a fresh hash.

Tool mutations use pi's file-mutation queue, atomic replacement, and a recovery snapshot of the prior content. Shared QMD operations are serialized across chat and jobs. These protections do not cover external editors/processes or arbitrary shell writes. The harness instructs the agent to use the memory tool, but it is not a filesystem sandbox.

A saved write remains successful if index refresh fails; the result includes `indexError`. Run `update` to retry. Retrieval refreshes the index before recall, throttled to once per second. Lexical recall is available after indexing. The housekeeping prompt calls `embed` once before acknowledging reviewed notes to refresh incremental embeddings for hybrid recall. New edits can lack vectors until that run; call `embed` manually when immediate semantic recall is needed. Startup predownloads models but does not embed the collection.

## Housekeeping

Catty installs `jobs/memory-maintenance` once. It uses the existing scheduler: a 24-hour interval, low priority, shared separate jobs session. The first scheduled run is after the first interval, not immediately on startup. Disable all scheduling with `[jobs].enabled = false`, or set `enabled = false` in this job's `meta.toml`. Deleting the installed job also stays respected. Existing folders with this job name are not overwritten.

The deterministic check hashes active notes and compares them with acknowledged versions. If nothing changed, no model call runs. Direct manual edits and removed notes are detected too. The bundled `scripts/check.ts.txt` template is installed as executable `scripts/check.ts`.

The prompt asks the agent to:

- Review at most 20 changed files per run, plus directly related notes when necessary.
- Move detail out of an oversized core without losing facts.
- Merge exact duplicates without losing source references or nuance.
- Flag unresolved contradictions, not guess the winner.
- Archive only explicitly obsolete topics; never delete source artifacts or recovery history.
- Refresh incremental embeddings before acknowledging reviewed versions; leave notes pending on embedding failure.
- Acknowledge only versions actually reviewed, so concurrent changes remain pending.
- Record a short summary in the existing jobs run log, without unsolicited Discord messages.

These are model instructions, not proof that a semantic edit is correct. Inferred personality, broad deletion, and scanning all conversations for new patterns are deliberately out of scope. Configure an explicit Discord destination in the job prompt if you want notifications about unresolved issues.

## Recovery and verification

Before each non-no-op memory-tool mutation, `.internal/memory-history/<timestamp>-<uuid>.json` stores the affected relative path, prior content/hash, action, and timestamp. Files are local, not automatically published or pruned. History and archives can contain sensitive facts; protect and back them up with the workspace. Archiving or correcting a fact is not a privacy purge.

To restore a snapshot, inspect its `file` and `content`, read the current target with the memory tool, and write the saved content using the **current** hash. For an archived note, read the returned `archivedFile` and create the active topic again with `expectedHash: null` if it is still absent. Neither restore should overwrite a newer note without review.

Before enabling this on important memory, verify in a disposable workspace:

1. Save a sourced preference in a topic; retrieve it by keyword and follow its core link.
2. Correct it with `read`/`write`; confirm the current note/search no longer presents the old value as current and the old content is recoverable.
3. Attempt two writes from one hash; confirm the second conflicts without overwriting the first.
4. Archive an obsolete project; confirm default search excludes it while explicit archive reads work.
5. Inspect an oversized core; confirm only a warning/preview is injected and the disk content remains intact.
6. Run housekeeping, then its deterministic check; expect no work after reviewed hashes are acknowledged, and work after another edit.
7. Ask representative recall questions in a fresh and a resumed session, including identity, corrected preferences, uncertainty, and obsolete projects. Measure loaded context and recall quality; prettier files alone are not success.
