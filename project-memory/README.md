# Project memory

A Claude Code mod for a repo that keeps shared memory in `memory/`, committed with the code. Notes are grouped into hubs by theme, so a session starts with a short hub list and opens only the hubs and notes a task needs. Notes about specific files load by themselves when Claude touches those files, and a pre-commit check keeps the links, hubs and sizes in order and flags memories a commit may have made stale.

The mod switches on in a repo that has `memory/MEMORY.md` and stays out of the way everywhere else.

## Layout

```
memory/
  MEMORY.md          one line per hub: - [Theme](hubs/<theme>.md) — hook   (2KB max)
  hubs/<theme>.md    one line per note: - [[slug]] — hook                  (4KB max)
  <slug>.md          a note: name / description frontmatter, the fact, a **Why:** line
  lint.sh            the pre-commit check
.claude/rules/memory/
  <slug>.md          a note with paths: globs, loaded when Claude reads or edits a match (1KB max)
.githooks/
  pre-commit         runs sh memory/lint.sh
```

A note can sit in every hub it fits, and `[[slug]]` links reach notes in either folder. A rejected approach is its own note with `status: rejected`. The skill has the full format.

## What's in it

| Part | What it does |
|---|---|
| Hook | Finds the nearest `memory/MEMORY.md` at or above the working directory and puts it in the system prompt with the reading rules. Claude saves only when you ask it to remember something, and offers once, in a line, after you correct it. In a hub layout it also keeps `memory/lint.sh` in step with the mod's copy and wires it into pre-commit (below). Without a memory folder it hides the keeper |
| `memory-keeper` agent (Haiku) | Fixes structure itself: hubs, index lines, links, duplicates, globs after a rename. Checks memories the lint flagged against the staged diff. What a note says is yours, so changes to it come back as proposals. Also runs the migration from a flat folder |
| `project-memory` skill | The layout, the note format and the saving steps |
| `lint.sh` | POSIX sh and git, so it runs wherever git does. It blocks a commit on a note without name, description or Why, a duplicate slug, a dead link, a note no hub lists, a hub `MEMORY.md` doesn't list, a size over its limit, or a glob that matches no tracked file. It warns, without blocking, when a commit changes files a memory's `paths` cover and leaves the memory untouched |

## The pre-commit hook

When the repo has no hook setup, the mod writes `.githooks/pre-commit` and sets `core.hooksPath .githooks`. Commit both `.githooks/` and `memory/lint.sh`: the check then runs for everyone who commits, mod or not, and in a fresh clone the mod only sets `core.hooksPath`.

When the repo already has one (Husky, the pre-commit framework, a hook of its own), the mod leaves it alone and Claude tells you to add `sh memory/lint.sh` to it.

The mod doesn't touch a flat folder (no `memory/hubs/`): its `MEMORY.md` still goes into the prompt, and it gets no lint.

## Moving from a flat folder

The keeper migrates on a branch, in three phases, because a big folder doesn't fit one Haiku context. The steps are in `skills/project-memory/migrate.md`:

1. **Plan.** One run reads each note's name and description and writes the hub list to `memory-migration/plan.md`.
2. **Convert.** One run per batch of about 15 notes. It drops `metadata.type`, splits rejections into their own notes, adds Why lines, and moves file-tied notes to `.claude/rules/memory/`. Each note gets a row in `memory-migration/table.md`.
3. **Hubs.** One run writes the hubs and the new `MEMORY.md`, then fixes structure until the lint passes.

Review `table.md`: the hubs, each glob and how many files it matches, and each split. Spot-check the diff, delete `memory-migration/`, then merge.

If the repo's `CLAUDE.md` tells Claude to read `memory/MEMORY.md`, or the repo has its own `project-memory` skill, remove them. The mod's prompt section replaces the first, and the skills would otherwise both show up.

## Install

```
/plugin install project-memory --marketplace noash-xrc/claude-tools
```
