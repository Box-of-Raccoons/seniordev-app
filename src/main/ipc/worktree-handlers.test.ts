import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers = new Map<string, (...a: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => handlers.set(ch, fn) }
}))

import { registerWorktreeIpc } from './worktree-handlers'
import type { GitRunner, GitResult } from '../git/git-runner'
import type { SessionPersistence } from '../session-persistence'
import type { ConfigSource } from '../config/store'

beforeEach(() => handlers.clear())

function fakeRunner(replies: Record<string, GitResult>): GitRunner & { calls: { cwd: string; args: string[] }[] } {
  const calls: { cwd: string; args: string[] }[] = []
  const fn = ((cwd: string, args: string[]): GitResult => {
    calls.push({ cwd, args })
    return replies[`${args[0]} ${args[1] ?? ''}`.trim()] ?? replies[args[0]] ?? { code: 0, stdout: '', stderr: '' }
  }) as GitRunner & { calls: { cwd: string; args: string[] }[] }
  fn.calls = calls
  return fn
}

function setup(over?: {
  runner?: GitRunner
  projects?: unknown[]
  conversations?: unknown[]
  repos?: { key: string; path: string; branchPrefix: string }[]
  now?: () => number
  setArchived?: (id: string, a: boolean) => void
}) {
  const runner = over?.runner ?? fakeRunner({})
  const projects = over?.projects ?? [{ id: 'p1', path: '/repo', worktreeDefault: false }]
  const conversations = over?.conversations ?? []
  const setArchived = vi.fn(over?.setArchived)
  const persistence = {
    projects: {
      list: () => projects,
      get: (id: string) => (projects as { id: string }[]).find((p) => p.id === id)
    },
    conversations: {
      get: (id: string) => (conversations as { id: string }[]).find((c) => c.id === id),
      setArchived
    }
  } as unknown as SessionPersistence
  const source = { config: { repos: over?.repos ?? [] } } as unknown as ConfigSource
  const send = vi.fn()
  registerWorktreeIpc({
    gitRunner: runner,
    source,
    persistence,
    configDir: '/cfg',
    getSender: () => ({ send }) as never,
    now: over?.now
  })
  return { runner, setArchived, send }
}

describe('worktree:info', () => {
  it('reports isRepo, the matched repo branchPrefix, and the remembered worktreeDefault', async () => {
    setup({
      runner: fakeRunner({ 'rev-parse --is-inside-work-tree': { code: 0, stdout: 'true\n', stderr: '' } }),
      repos: [{ key: 'R', path: '/repo', branchPrefix: 'hardy/' }],
      projects: [{ id: 'p1', path: '/repo', worktreeDefault: true }]
    })
    expect(await handlers.get('worktree:info')!({}, '/repo')).toEqual({
      isRepo: true,
      branchPrefix: 'hardy/',
      worktreeDefault: true
    })
  })

  it('empty branchPrefix + false default when the folder is a repo but not configured', async () => {
    setup({
      runner: fakeRunner({ 'rev-parse --is-inside-work-tree': { code: 0, stdout: 'true\n', stderr: '' } }),
      repos: [],
      projects: []
    })
    expect(await handlers.get('worktree:info')!({}, '/somewhere')).toEqual({
      isRepo: true,
      branchPrefix: '',
      worktreeDefault: false
    })
  })

  it('caches within the TTL: git is not re-run on a second call', async () => {
    let t = 1000
    const runner = fakeRunner({ 'rev-parse --is-inside-work-tree': { code: 0, stdout: 'true\n', stderr: '' } })
    setup({ runner, now: () => t })
    await handlers.get('worktree:info')!({}, '/repo')
    t += 30_000 // still inside the 60s TTL
    await handlers.get('worktree:info')!({}, '/repo')
    expect(runner.calls.length).toBe(1)
    t += 40_000 // now past the TTL
    await handlers.get('worktree:info')!({}, '/repo')
    expect(runner.calls.length).toBe(2)
  })
})

describe('worktree:create', () => {
  it('creates off the folder using the configured repo key and returns the path', async () => {
    const runner = fakeRunner({ 'worktree add': { code: 0, stdout: '', stderr: '' } })
    setup({ runner, repos: [{ key: 'R', path: '/repo', branchPrefix: 'hardy/' }] })
    const res = (await handlers.get('worktree:create')!({}, { folder: '/repo', branch: 'hardy/thing' })) as {
      ok: boolean
      worktreePath?: string
    }
    expect(res.ok).toBe(true)
    expect(res.worktreePath!.replace(/\\/g, '/')).toBe('/cfg/worktrees/R/hardy-thing')
  })

  it('falls back to the folder basename as the repo key when unconfigured', async () => {
    const runner = fakeRunner({ 'worktree add': { code: 0, stdout: '', stderr: '' } })
    setup({ runner, repos: [] })
    const res = (await handlers.get('worktree:create')!({}, { folder: '/home/me/myapp', branch: 'x' })) as {
      ok: boolean
      worktreePath?: string
    }
    expect(res.worktreePath!.replace(/\\/g, '/')).toBe('/cfg/worktrees/myapp/x')
  })

  it('returns the collision error unchanged from the service', async () => {
    const runner = fakeRunner({ 'worktree add': { code: 128, stdout: '', stderr: "fatal: a branch named 'x' already exists\n" } })
    setup({ runner })
    const res = (await handlers.get('worktree:create')!({}, { folder: '/repo', branch: 'x' })) as { ok: boolean; error?: string }
    expect(res).toEqual({ ok: false, error: "a branch named 'x' already exists" })
  })
})

describe('worktree:teardown', () => {
  it('archives the conversation and nudges the sidebar, no removal when not opted in', async () => {
    const runner = fakeRunner({})
    const { setArchived, send } = setup({
      runner,
      conversations: [{ id: 'c1', projectId: 'p1', worktreePath: '/cfg/worktrees/R/x' }]
    })
    const res = await handlers.get('worktree:teardown')!({}, { conversationId: 'c1', removeWorktree: false })
    expect(setArchived).toHaveBeenCalledWith('c1', true)
    expect(res).toEqual({ archived: true })
    expect(runner.calls.length).toBe(0) // no git run
    expect(send).toHaveBeenCalledWith('sidebar:changed')
  })

  it('removes the worktree from the project path when opted in', async () => {
    const runner = fakeRunner({ 'worktree remove': { code: 0, stdout: '', stderr: '' } })
    setup({
      runner,
      projects: [{ id: 'p1', path: '/repo', worktreeDefault: false }],
      conversations: [{ id: 'c1', projectId: 'p1', worktreePath: '/cfg/worktrees/R/x' }]
    })
    const res = await handlers.get('worktree:teardown')!({}, { conversationId: 'c1', removeWorktree: true })
    expect(res).toEqual({ archived: true, worktree: { ok: true } })
    expect(runner.calls[0]).toEqual({ cwd: '/repo', args: ['worktree', 'remove', '/cfg/worktrees/R/x'] })
  })

  it('reports a dirty-worktree removal failure but still archives', async () => {
    const runner = fakeRunner({
      'worktree remove': { code: 128, stdout: '', stderr: 'fatal: contains modified or untracked files, use --force\n' }
    })
    const { setArchived } = setup({
      runner,
      conversations: [{ id: 'c1', projectId: 'p1', worktreePath: '/cfg/worktrees/R/x' }]
    })
    const res = (await handlers.get('worktree:teardown')!({}, { conversationId: 'c1', removeWorktree: true })) as {
      archived: boolean
      worktree?: { ok: boolean; error?: string }
    }
    expect(setArchived).toHaveBeenCalledWith('c1', true)
    expect(res.archived).toBe(true)
    expect(res.worktree).toEqual({ ok: false, error: 'worktree has uncommitted changes; not removed' })
  })

  it('is a no-op result for an unknown conversation', async () => {
    setup({ conversations: [] })
    expect(await handlers.get('worktree:teardown')!({}, { conversationId: 'nope', removeWorktree: true })).toEqual({
      archived: false
    })
  })
})
