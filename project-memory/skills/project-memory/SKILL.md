---
name: project-memory
description: Save, update or forget a memory in this repo's memory/ folder, and the format every memory follows. Use when the user says "remember", "save to memory", "forget" or "update memory".
---

# Project memory

Shared memory for the repo, committed with the code. Save only what a future session can't get from the code or git history: decisions and why, user corrections, rejected approaches, constraints, gotchas, pointers to external resources.

## Layout

```
memory/
  MEMORY.md          one line per hub: - [Theme](hubs/<theme>.md) — hook       loads every session, 2KB max
  hubs/<theme>.md    one line per note on that theme: - [[slug]] — hook        4KB max
  <slug>.md          a note
  lint.sh            the pre-commit check, kept current by the mod
.claude/rules/memory/
  <slug>.md          a note tied to files, loaded when Claude reads or edits one   1KB max
```

A hub covers one theme of the project. A note goes in every hub whose theme it fits. A hook names the topic and its key word or trap in 150 characters at most.

## A note

```markdown
---
name: <slug, same as the file name>
description: <one line used to judge relevance>
paths:
  - "src/save/**/*.cs"
status: rejected
---

<the fact, with absolute dates. Link related notes with [[their-slug]].>

**Why:** <the reason. It tells a later session whether the fact still holds.>
```

- `paths` only in `.claude/rules/memory/`: git globs, relative to the repo root. Claude Code loads the note when Claude reads or edits a matching file.
- `status: rejected` marks an approach not to re-propose. The rejection is the whole note, with its Why. Link it from the note about what was chosen instead.
- One idea per note. Slugs are unique across both folders, and `[[slug]]` links reach either.
- A fact about specific files goes in `.claude/rules/memory/`. When it needs more than 1KB, keep the key fact there and link a `memory/` note that holds the detail.

## Saving

1. Grep `memory/hubs/` and the notes for the topic. When a note covers it, edit that note.
2. Otherwise write the note in the folder that fits.
3. Add its line to every hub it fits. A new hub also gets a line in `MEMORY.md`.
4. Run `sh memory/lint.sh` and fix what it reports. The same check blocks the commit.

To forget, delete the note, its hub lines, and the `[[links]]` to it.
