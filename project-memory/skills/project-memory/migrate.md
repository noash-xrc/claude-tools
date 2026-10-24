# Migrating a flat memory folder to hubs

A flat folder has `memory/MEMORY.md` indexing every note, notes with `metadata.type`, and rejections marked inside the text with `REJECTED` or "don't re-propose". Migration runs on a branch in three phases, each a separate memory-keeper run, because a large folder doesn't fit one context. The working files go in `memory-migration/` at the repo root, outside `memory/`, so the lint ignores them. The main session deletes that folder before merging.

Keep every fact's wording. Migration moves, splits and re-labels text. It doesn't rewrite it.

## Phase 1: plan

Read `memory/MEMORY.md` and each note's `name` and `description` lines (grep them; skip the bodies). Write `memory-migration/plan.md`:

```
## <theme>
<one-line hook for MEMORY.md>
- <slug>
```

Every note sits under at least one theme. A theme holds at most 20 notes, so its hub stays under 4KB. Split a bigger theme. Done when every slug in `memory/` appears in the plan.

## Phase 2: convert a batch

The request names the slugs in your batch. For each note:

1. Drop `metadata` and `type` from the frontmatter. Make `name` equal the file name.
2. For each rejected approach inside a note that also holds accepted facts, move the rejection into its own note with `status: rejected` and a slug ending in `-rejected`. Link the two notes to each other with `[[slug]]`.
3. Give every note a `**Why:**` line, using the reason the note gives. When it gives none, write `**Why:** not recorded when this was saved.`
4. When a note is about specific files, check them with `git ls-files`. Under 1KB, move the note to `.claude/rules/memory/` with `paths` globs. Over 1KB, keep it in `memory/` and add a rules note of at most 1KB with the globs, the key fact and a `[[link]]` to it.
5. Append one row per resulting note to `memory-migration/table.md`:

```
| slug | from | action | paths | files matched |
```

`action` is kept, split, moved or digest. `files matched` is the count `git ls-files -- ':(glob)<pattern>'` returns for each glob. A count of 0, or one in the hundreds, means a wrong glob, so fix it before moving on.

Done when every slug in the batch has its rows.

## Phase 3: hubs

From `plan.md` and `table.md`, write `memory/hubs/<theme>.md`, one `- [[slug]] — hook` line per note. A split-off note goes in its source note's hubs. Rewrite `memory/MEMORY.md` as the hub list, one `- [Theme](hubs/<theme>.md) — hook` line each. Copy the plugin's `lint.sh` to `memory/lint.sh` when the request gives its path, then fix structure until `sh memory/lint.sh` passes. Done when it passes.
