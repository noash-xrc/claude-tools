import type { Register } from 'claude-code'

// Under this, the index goes straight into the prompt: cheaper than a recall's answer, and no 40-second wait.
const INLINE_MAX = 4 * 1024
// Over this, the index needs compacting. The skill and memory-keeper use the same number.
const COMPACT_AT = 16 * 1024
// Rejected lines past this many bytes stay in the files; the prompt points at them.
const REJECTED_MAX = 4 * 1024
const REJECTED = /REJECTED|don't re-propose/i

// A rejected sentence past this many bytes is cut; the file suffix points at the rest.
const EXCERPT_MAX = 300

const bytes = (s: string) => new TextEncoder().encode(s).length

// Only the sentences that carry the marker, so one long paragraph can't fill REJECTED_MAX on its own.
const excerpt = (line: string) => {
  const text = line.trim().replace(/^(?:[-*]\s+|#+\s*)/, '').split(/(?<=[.!?])\s+/).filter(s => REJECTED.test(s)).join(' ')
  if (bytes(text) <= EXCERPT_MAX) return text
  let cut = text.slice(0, EXCERPT_MAX)
  while (bytes(cut) > EXCERPT_MAX - 3) cut = cut.slice(0, -1)
  return `${cut.replace(/\s+\S*$/, '')}…`
}

type Memory = { dir: string; index: string; rejected: string[]; unreadable: string[] }

// Read once per session start: a repo gains a memory folder rarely enough that a reload catches it.
let memory: Memory | undefined

const isSmall = (m: Memory) => bytes(m.index) <= INLINE_MAX

// The lines that fit in REJECTED_MAX bytes, then one line counting what was left out.
const capRejected = (lines: string[]) => {
  let used = 0
  const kept = lines.filter(l => (used += bytes(l) + 1) <= REJECTED_MAX)
  return kept.length < lines.length ? [...kept, `- ${lines.length - kept.length} more in the memory files. Search them for REJECTED before proposing an approach.`] : kept
}

const sectionText = (m: Memory) => [
  '# Project memory',
  `This repo keeps shared memory in \`${m.dir}\`, one file per memory, indexed in \`MEMORY.md\` there.`,
  isSmall(m)
    ? `Before a non-trivial task, read the memory files whose index lines bear on it. The index:\n\n${m.index.trim()}`
    : `Before a non-trivial task, ask the \`project-memory:memory-recall\` agent what the memory says about the task, and give it the folder's path. Don't read the folder yourself unless its answer points you to a file you need in full.`,
  ...(m.rejected.length ? ['Rejected approaches. Never re-propose these:', ...capRejected(m.rejected)] : []),
  ...(m.unreadable.length ? [`Couldn't read ${m.unreadable.join(', ')}. Any rejected approaches in them are missing here, so open them before proposing an approach.`] : []),
  ...(bytes(m.index) > COMPACT_AT ? [`The index is over 16KB. At a pause in the work, hand compacting to the \`project-memory:memory-keeper\` agent.`] : []),
  'To save a memory, follow the `project-memory` skill. To compact the index or clean up the folder, hand it to the `project-memory:memory-keeper` agent.',
].join('\n')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // The nearest memory/MEMORY.md at or above the working directory, so a session started in a subfolder finds it.
    const found = (await $.fs.ancestors({ names: ['memory/MEMORY.md'] }).catch(() => [])).at(-1)
    let loaded: Memory | undefined
    if (found) {
      const dir = `${found.dir.replace(/[\\/]$/, '')}/memory`
      const files = (await $.fs.list(dir).catch(() => []))
        .filter(f => f.kind === 'file' && f.name.endsWith('.md') && f.name !== 'MEMORY.md')
      const unreadable: string[] = []
      const rejected = (await Promise.all(files.map(async f => {
        const text = await $.fs.read(`${dir}/${f.name}`).catch(() => { unreadable.push(`memory/${f.name}`); return '' })
        return text.split('\n').filter(l => REJECTED.test(l)).map(l => `- ${excerpt(l)} (memory/${f.name})`)
      }))).flat()
      loaded = { dir, index: found.parts[0]?.content ?? found.content, rejected, unreadable }
    }
    memory = loaded
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    return memory ? { sections: [...r.sections, { id: 'project-memory:recall', scope: 'session', text: sectionText(memory) }] } : r
  })

  // The agents only make sense where there is a memory folder, and recall only where the index is too big to inline.
  on('agent.offer', async ($, e, next) => {
    if (!e.agent.startsWith('project-memory:')) return next(e)
    if (!memory || (e.agent === 'project-memory:memory-recall' && isSmall(memory))) return { isOffered: false }
    return next(e)
  }).catch(($, e, next) => next(e))
}
