import type { EngineInterface, Register } from 'claude-code'

type Memory = { dir: string; index: string; hubs: boolean; hookNote?: string }

// Read once per session start: a repo gains a memory folder rarely enough that a reload catches it.
let memory: Memory | undefined

const LINT_CALL = 'sh memory/lint.sh'
const HOOK = `#!/bin/sh\n${LINT_CALL}\n`

const isAbsolute = (p: string) => /^([a-zA-Z]:)?[\\/]/.test(p)

// Keeps memory/lint.sh current and wires it into pre-commit. A repo's own hook setup is never touched:
// the answer is then a line for Claude to pass on.
const install = async ($: EngineInterface, root: string): Promise<string | undefined> => {
  const lint = await $.fs.read(`${$.plugin.root}/lint.sh`)
  // CRs dropped, so a CRLF checkout of the same script isn't rewritten every session.
  const copy = await $.fs.read(`${root}/memory/lint.sh`).catch(() => '')
  if (copy.replace(/\r/g, '') !== lint.replace(/\r/g, '')) await $.fs.write(`${root}/memory/lint.sh`, lint)

  const git = async (...args: string[]) => (await $.process.run(['git', ...args], { cwd: root })).stdout.trim()
  const hooksPath = await git('config', '--get', 'core.hooksPath')
  const hooksDir = await git('rev-parse', '--git-path', 'hooks')
  const active = `${isAbsolute(hooksDir) ? hooksDir : `${root}/${hooksDir}`}/pre-commit`
  const activeHook = await $.fs.read(active).catch(() => undefined)
  if (activeHook?.includes(LINT_CALL)) return

  const ours = `${root}/.githooks/pre-commit`
  if (activeHook === undefined && (!hooksPath || hooksPath === '.githooks')) {
    const existing = await $.fs.read(ours).catch(() => undefined)
    if (existing === undefined) {
      await $.fs.write(ours, HOOK)
      await $.process.run(['chmod', '+x', ours]).catch(() => undefined)
    } else if (!existing.includes(LINT_CALL)) return `\`.githooks/pre-commit\` exists but doesn't run the memory lint. Tell the user once: add \`${LINT_CALL}\` to it.`
    if (!hooksPath) await git('config', 'core.hooksPath', '.githooks')
    return
  }
  return `This repo has its own pre-commit setup (${activeHook === undefined ? `core.hooksPath ${hooksPath}` : active}), so the memory lint isn't wired in. Tell the user once: add \`${LINT_CALL}\` to that hook.`
}

const sectionText = (m: Memory) => [
  '# Project memory',
  m.hubs
    ? [
        `This repo keeps shared memory in \`${m.dir}\`. \`MEMORY.md\` lists its hubs. Each hub in \`hubs/\` lists the notes on one theme as \`[[slug]]\` lines.`,
        'A note is `memory/<slug>.md`, or `.claude/rules/memory/<slug>.md` when it is tied to files: those load by themselves when you read or edit a matching file.',
        'Before a non-trivial task, open the hubs whose themes it touches, then the notes that bear on it, and follow `[[links]]` that look relevant. A note with `status: rejected` is an approach not to re-propose.',
      ].join('\n')
    : `This repo keeps shared memory in \`${m.dir}\`, indexed in \`MEMORY.md\`. Before a non-trivial task, read the memory files whose index lines bear on it.`,
  `\n${m.index.trim()}\n`,
  'Save a memory only when the user asks you to remember something, following the `project-memory` skill. After the user corrects you or rejects an approach, offer once, in one line, to save it.',
  'Hand structure fixes, stale-memory checks and cleanup to the `project-memory:memory-keeper` agent. When the pre-commit lint lists memories to recheck, give it those files and `git diff --cached`.',
  ...(m.hookNote ? [m.hookNote] : []),
].join('\n')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // The nearest memory/MEMORY.md at or above the working directory, so a session started in a subfolder finds it.
    const found = (await $.fs.ancestors({ names: ['memory/MEMORY.md'] }).catch(() => [])).at(-1)
    let loaded: Memory | undefined
    if (found) {
      const root = found.dir.replace(/[\\/]$/, '')
      const dir = `${root}/memory`
      // Only the hub layout gets the lint: a flat folder would fail every check.
      const hubs = await $.fs.exists(`${dir}/hubs`).catch(() => false)
      // $.process is CLI only, so elsewhere the hook stays unwired and the prompt still loads.
      const hookNote = hubs ? await install($, root).catch(() => undefined) : undefined
      loaded = { dir, index: found.parts[0]?.content ?? found.content, hubs, hookNote }
    }
    memory = loaded
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    return memory ? { sections: [...r.sections, { id: 'project-memory:recall', scope: 'session', text: sectionText(memory) }] } : r
  })

  // The keeper only makes sense where there is a memory folder.
  on('agent.offer', async ($, e, next) => {
    if (!e.agent.startsWith('project-memory:')) return next(e)
    if (!memory) return { isOffered: false }
    return next(e)
  }).catch(($, e, next) => next(e))
}
