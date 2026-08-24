import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers = new Map<string, (...a: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => handlers.set(ch, fn) }
}))

import { registerReviewIpc, targetsFromConversations } from './review-handlers'
import { REVIEW, type ReviewTreeInfo, type ReviewDiffInfo } from '../../shared/ipc'
import type { GitRunner, GitResult } from '../git/git-runner'
import type { SessionPersistence } from '../session-persistence'

beforeEach(() => handlers.clear())

const ok = (stdout: string): GitResult => ({ code: 0, stdout, stderr: '' })

function fakeRunner(replies: Record<string, GitResult>): GitRunner {
  return (_cwd: string, args: string[]): GitResult => replies[args.join(' ')] ?? ok('')
}

type Conv = {
  id: string
  title: string
  tool: string
  cwd: string
  worktreePath: string | null
  branch: string | null
  archivedAt: number | null
}

const conv = (over: Partial<Conv> = {}): Conv => ({
  id: 'c1',
  title: 'Fix it',
  tool: 'claude',
  cwd: '/repo',
  worktreePath: null,
  branch: null,
  archivedAt: null,
  ...over
})

function setup(conversations: Conv[], runner: GitRunner): void {
  const persistence = { conversations: { list: () => conversations } } as unknown as SessionPersistence
  registerReviewIpc({ gitRunner: runner, persistence })
}

describe('targetsFromConversations', () => {
  it('prefers the worktree path, because that is the tree holding the changes', () => {
    const [t] = targetsFromConversations([conv({ cwd: '/repo', worktreePath: '/wt/feature' })])
    expect(t.cwd).toBe('/wt/feature')
  })

  it('falls back to the plain cwd when there is no worktree', () => {
    expect(targetsFromConversations([conv()])[0].cwd).toBe('/repo')
  })

  it('drops archived conversations', () => {
    expect(targetsFromConversations([conv({ archivedAt: 123 })])).toEqual([])
  })

  it('drops conversations with no folder at all', () => {
    expect(targetsFromConversations([conv({ cwd: '', worktreePath: null })])).toEqual([])
  })
})

describe(REVIEW.list, () => {
  it('omits a clean tree so the overview lists only what needs reviewing', async () => {
    setup([conv()], fakeRunner({ 'rev-parse --is-inside-work-tree': ok('true\n') }))
    const out = (await handlers.get(REVIEW.list)!()) as ReviewTreeInfo[]
    expect(out).toEqual([])
  })

  it('lists a tree with changes, with its counts', async () => {
    setup(
      [conv()],
      fakeRunner({
        'rev-parse --is-inside-work-tree': ok('true\n'),
        'diff HEAD --numstat': ok('4\t2\tsrc/a.ts\n')
      })
    )
    const [tree] = (await handlers.get(REVIEW.list)!()) as ReviewTreeInfo[]
    expect(tree.cwd).toBe('/repo')
    expect(tree.files).toBe(1)
    expect(tree.insertions).toBe(4)
    expect(tree.deletions).toBe(2)
  })

  it('collapses two sessions on one folder into one tree carrying both', async () => {
    setup(
      [conv({ id: 'a', title: 'First' }), conv({ id: 'b', title: 'Second' })],
      fakeRunner({
        'rev-parse --is-inside-work-tree': ok('true\n'),
        'diff HEAD --numstat': ok('1\t0\tsrc/a.ts\n')
      })
    )
    const out = (await handlers.get(REVIEW.list)!()) as ReviewTreeInfo[]
    expect(out).toHaveLength(1)
    expect(out[0].sessions.map((s) => s.title)).toEqual(['First', 'Second'])
  })

  it('KEEPS a tree git could not read, because omitting it would read as clean', async () => {
    setup(
      [conv()],
      fakeRunner({
        'rev-parse --is-inside-work-tree': { code: 128, stdout: '', stderr: 'fatal: not a git repository' }
      })
    )
    const [tree] = (await handlers.get(REVIEW.list)!()) as ReviewTreeInfo[]
    expect(tree.error).toMatch(/not a git repository/i)
    expect(tree.files).toBe(0)
  })
})

describe(REVIEW.diff, () => {
  it('returns the parsed diff for a tree', async () => {
    setup(
      [conv()],
      fakeRunner({
        'rev-parse --is-inside-work-tree': ok('true\n'),
        'diff HEAD --': ok(`diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@ -1,1 +1,1 @@
-a
+b
`)
      })
    )
    const r = (await handlers.get(REVIEW.diff)!({}, '/repo', null)) as ReviewDiffInfo
    expect(r.error).toBeNull()
    expect(r.files[0].path).toBe('x.ts')
    expect(r.files[0].hunks[0].lines.map((l) => l.kind)).toEqual(['del', 'add'])
  })

  it('treats a missing path argument as the whole tree', async () => {
    setup([conv()], fakeRunner({ 'rev-parse --is-inside-work-tree': ok('true\n') }))
    const r = (await handlers.get(REVIEW.diff)!({}, '/repo', undefined)) as ReviewDiffInfo
    expect(r.error).toBeNull()
    expect(r.files).toEqual([])
  })
})
