// The review IPC against REAL git. Every unit test for review-service drives an
// injected fake GitRunner, so this spec is the only thing proving the actual git
// invocations are right: the argv, the untracked scan, and the parse of what git
// really emits on this machine.
//
// It calls through `window.api`, so the path exercised is
// preload -> ipcMain -> review-service -> git -> back, which is the whole feature
// minus the click. The sandbox repo is seeded by fixtures.ts (one commit, then a
// tracked edit plus an untracked file, the state an agent leaves behind).
import { browser, expect } from '@wdio/globals'

interface ReviewEntry {
  path: string
  insertions: number
  deletions: number
  binary: boolean
  untracked: boolean
}
interface ReviewTree {
  cwd: string
  branch: string | null
  sessions: { title: string }[]
  files: number
  insertions: number
  deletions: number
  entries: ReviewEntry[]
  error: string | null
}
interface ReviewDiff {
  files: { path: string; status: string; insertions: number; deletions: number; hunks: { lines: { kind: string; text: string }[] }[] }[]
  error: string | null
}

const listReview = (): Promise<ReviewTree[]> =>
  browser.execute(() => (window as unknown as { api: { listReview(): Promise<unknown> } }).api.listReview()) as Promise<ReviewTree[]>

const reviewDiff = (cwd: string, path: string | null): Promise<ReviewDiff> =>
  browser.execute(
    (c, p) =>
      (window as unknown as { api: { reviewDiff(c: string, p: string | null): Promise<unknown> } }).api.reviewDiff(c, p),
    cwd,
    path
  ) as Promise<ReviewDiff>

describe('review over a real git working tree', () => {
  it('finds the seeded repo with both its tracked edit and its untracked file', async () => {
    // The stores load asynchronously at boot; poll rather than assuming timing.
    await browser.waitUntil(async () => (await listReview()).length > 0, {
      timeout: 30_000,
      timeoutMsg: 'review never listed the seeded repo'
    })

    const trees = await listReview()
    // The seeded git repo, plus the seeded non-repo folder (asserted below).
    expect(trees).toHaveLength(2)
    const tree = trees.find((t) => t.cwd.endsWith('/repo'))!
    expect(tree).toBeDefined()
    expect(tree.error).toBeNull()
    // One tracked file changed, one untracked file added.
    expect(tree.files).toBe(2)

    const tracked = tree.entries.find((e) => e.path === 'tracked.txt')
    expect(tracked).toBeDefined()
    expect(tracked!.untracked).toBe(false)
    expect(tracked!.insertions).toBe(1)
    expect(tracked!.deletions).toBe(1)

    const untracked = tree.entries.find((e) => e.path === 'untracked.txt')
    expect(untracked).toBeDefined()
    expect(untracked!.untracked).toBe(true)
    expect(untracked!.insertions).toBe(1)
  })

  it('names the branch git actually reports', async () => {
    const [tree] = await listReview()
    // Whatever `git init` defaults to here; the point is that a real name came
    // back rather than the null the conversation record was seeded with.
    expect(typeof tree.branch).toBe('string')
    expect(tree.branch!.length).toBeGreaterThan(0)
  })

  it('parses the real unified diff for the tracked edit', async () => {
    const [tree] = await listReview()
    const diff = await reviewDiff(tree.cwd, 'tracked.txt')
    expect(diff.error).toBeNull()
    expect(diff.files).toHaveLength(1)
    expect(diff.files[0].status).toBe('modified')

    const lines = diff.files[0].hunks.flatMap((h) => h.lines)
    expect(lines.find((l) => l.kind === 'del')?.text).toBe('two')
    expect(lines.find((l) => l.kind === 'add')?.text).toBe('CHANGED')
  })

  it('reads an untracked file through --no-index, since HEAD has no side for it', async () => {
    const [tree] = await listReview()
    const diff = await reviewDiff(tree.cwd, 'untracked.txt')
    expect(diff.error).toBeNull()
    expect(diff.files).toHaveLength(1)
    expect(diff.files[0].status).toBe('added')
    expect(diff.files[0].hunks.flatMap((h) => h.lines).map((l) => l.text)).toContain('brand new')
  })

  it('KEEPS a non-repo folder in the list, marked unreadable rather than clean', async () => {
    const trees = await listReview()
    const bad = trees.find((t) => t.cwd.endsWith('seniordev-e2e-not-a-repo'))
    expect(bad).toBeDefined()
    // Present, with a reason. Dropping it would render as "nothing to review",
    // which is the one wrong answer a supervision surface must never give.
    expect(bad!.error).toMatch(/not a git repository/i)
    expect(bad!.files).toBe(0)
  })

  // NOTE: probing reviewDiff() with a bare non-repo path (e.g. '/') was tried and
  // dropped. It fails inside WDIO's execute transport, not in the app, and a
  // renderer-side try/catch does not intercept it. That path stays covered by the
  // unit tests in review-service.test.ts, which drive it through a fake runner.
})
