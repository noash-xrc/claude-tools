import { test, expect } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type Engine = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

// files: repo-relative paths with forward slashes. hooksPath: what `git config core.hooksPath` holds.
type Repo = { index?: string; hubs?: boolean; files?: Record<string, string>; hooksPath?: string; noProcess?: boolean }

const LINT = '#!/bin/sh\n# the shipped lint\n'

// the engine beneath the plugin: a repo at C:\repo, its memory/MEMORY.md found by the ancestor walk, one engine section in the prompt
const engine = (on: On, repo: Repo) => {
  const files = { ...repo.files }
  const ran: string[] = []
  const rel = (path: string) => path.replace(/\\/g, '/').replace(/^C:\/repo\//, '')
  let hooksPath = repo.hooksPath
  on('session.start', () => ({ cwd: 'C:\\repo\\sub' }) as never)
  on('fs.ancestors', () => ({ value: repo.index === undefined ? [] : [{ dir: 'C:\\repo', name: 'memory/MEMORY.md', content: repo.index, parts: [{ path: 'C:\\repo\\memory\\MEMORY.md', content: repo.index }] }] }) as never)
  on('fs.exists', (_$, e) => ({ value: rel(e.path) === 'memory/hubs' && !!repo.hubs }))
  on('fs.read', (_$, e) => {
    // anything outside the repo is the plugin's own folder
    if (!e.path.replace(/\\/g, '/').startsWith('C:/repo/')) return { value: LINT } as never
    const text = files[rel(e.path)]
    if (text === undefined) throw new Error('ENOENT')
    return { value: text } as never
  })
  on('fs.write', (_$, e) => ((files[rel(e.path)] = e.text), { value: undefined }))
  on('process.run', (_$, e) => {
    if (repo.noProcess) throw new Error('not in this surface')
    ran.push(e.argv.join(' '))
    const [, ...args] = e.argv
    if (args.join(' ') === 'config --get core.hooksPath') return { value: { exitCode: hooksPath ? 0 : 1, stdout: hooksPath ?? '', stderr: '' } } as never
    if (args.join(' ') === 'rev-parse --git-path hooks') return { value: { exitCode: 0, stdout: `${hooksPath ?? '.git/hooks'}\n`, stderr: '' } } as never
    if (args[0] === 'config' && args[1] === 'core.hooksPath') hooksPath = args[2]
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'intro', scope: 'shared' }] }))
  on('agent.offer', () => ({ isOffered: true }))
  return { files, ran, hooksPath: () => hooksPath }
}

const start = ($: Engine) => $.session.start({ cwd: 'C:\\repo\\sub', surface: 'terminal', isInteractive: true } as never)
const sections = async ($: Engine) => (await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] })).sections
const section = async ($: Engine) => (await sections($)).find(s => s.id === 'project-memory:recall')?.text ?? ''
const offered = async ($: Engine, agent: string) =>
  (await $.agent.offer({ agent, description: 'd', source: 'plugin', provider: { plugin: 'project-memory', tier: 'user' } } as never)).isOffered

const hubLine = '- [Save system](hubs/save.md) — save format and its traps\n'
const flatLine = '- [Some decision](some-decision.md) — a hook naming the topic\n'

test('a hub layout puts the hub list in the prompt and offers the keeper', async ($, on) => {
  engine(on, { index: hubLine, hubs: true })
  await start($)
  const text = await section($)
  expect((await sections($)).map(s => s.id)).toEqual(['intro', 'project-memory:recall'])
  expect(text).toContain('C:\\repo/memory')
  expect(text).toContain('[Save system](hubs/save.md)')
  expect(text).toContain('status: rejected')
  expect(text).toContain('only when the user asks you to remember')
  expect(await offered($, 'project-memory:memory-keeper')).toBe(true)
})

test('a repo with no hook setup gets the lint copy, a pre-commit hook and core.hooksPath', async ($, on) => {
  const repo = engine(on, { index: hubLine, hubs: true })
  await start($)
  expect(repo.files['memory/lint.sh']).toBe(LINT)
  expect(repo.files['.githooks/pre-commit']).toBe('#!/bin/sh\nsh memory/lint.sh\n')
  expect(repo.hooksPath()).toBe('.githooks')
  expect(await section($)).not.toContain('Tell the user')
})

test('a stale lint copy is replaced and a wired repo is otherwise left alone', async ($, on) => {
  const repo = engine(on, { index: hubLine, hubs: true, hooksPath: '.githooks', files: { 'memory/lint.sh': 'old', '.githooks/pre-commit': '#!/bin/sh\nsh memory/lint.sh\n' } })
  await start($)
  expect(repo.files['memory/lint.sh']).toBe(LINT)
  expect(repo.ran.filter(c => c.startsWith('git config core.hooksPath'))).toEqual([])
})

test('a fresh clone with the committed hook only gets core.hooksPath', async ($, on) => {
  const hook = '#!/bin/sh\nnpm test\nsh memory/lint.sh\n'
  const repo = engine(on, { index: hubLine, hubs: true, files: { 'memory/lint.sh': LINT, '.githooks/pre-commit': hook } })
  await start($)
  expect(repo.files['.githooks/pre-commit']).toBe(hook)
  expect(repo.hooksPath()).toBe('.githooks')
})

test("a repo's own pre-commit hook is left alone and Claude is told what to add", async ($, on) => {
  const repo = engine(on, { index: hubLine, hubs: true, files: { '.git/hooks/pre-commit': '#!/bin/sh\npre-commit run\n' } })
  await start($)
  expect(repo.files['.githooks/pre-commit']).toBeUndefined()
  expect(repo.hooksPath()).toBeUndefined()
  expect(await section($)).toContain('own pre-commit setup')
  expect(await section($)).toContain('add `sh memory/lint.sh`')
})

test('husky, which sets its own core.hooksPath, is left alone', async ($, on) => {
  const repo = engine(on, { index: hubLine, hubs: true, hooksPath: '.husky/_' })
  await start($)
  expect(repo.files['.githooks/pre-commit']).toBeUndefined()
  expect(repo.hooksPath()).toBe('.husky/_')
  expect(await section($)).toContain('core.hooksPath .husky/_')
})

test('a flat memory folder gets its index in the prompt and no lint', async ($, on) => {
  const repo = engine(on, { index: flatLine })
  await start($)
  expect(await section($)).toContain('[Some decision](some-decision.md)')
  expect(await section($)).toContain('index lines bear on it')
  expect(repo.files['memory/lint.sh']).toBeUndefined()
  expect(repo.ran).toEqual([])
})

test('the prompt still loads where commands cannot run', async ($, on) => {
  engine(on, { index: hubLine, hubs: true, noProcess: true })
  await start($)
  expect(await section($)).toContain('[Save system](hubs/save.md)')
})

test('a repo without memory gets neither, and other agents are untouched', async ($, on) => {
  engine(on, {})
  await start($)
  expect((await sections($)).map(s => s.id)).toEqual(['intro'])
  expect(await offered($, 'project-memory:memory-keeper')).toBe(false)
  expect(await offered($, 'Explore')).toBe(true)
})
