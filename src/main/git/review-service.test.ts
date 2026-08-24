import { describe, it, expect } from 'vitest'
import { reviewSummary, reviewDiff, groupTargetsByTree, UNTRACKED_CAP, type ReviewTarget } from './review-service'
import type { GitRunner, GitResult } from './git-runner'

const ok = (stdout: string): GitResult => ({ code: 0, stdout, stderr: '' })
const fail = (stderr: string, code = 128): GitResult => ({ code, stdout: '', stderr })

// Fake git keyed on the joined argv, so a test states exactly which git question
// it is answering. Anything unstubbed comes back as a clean empty success, which
// keeps each test to the calls it actually cares about.
//
// Leading `-c key=value` config pairs are stripped before keying and recording:
// every review call carries `-c core.quotepath=off`, and that is a property of
// how we invoke git, not part of the question being asked. One test below
// asserts the flag is present; the rest should not have to know about it.
function stripConfigFlags(args: string[]): string[] {
  const out = [...args]
  while (out[0] === '-c') out.splice(0, 2)
  return out
}
function fakeGit(map: Record<string, GitResult>): GitRunner & { calls: string[][]; rawCalls: string[][] } {
  const calls: string[][] = []
  const rawCalls: string[][] = []
  const runner = ((_cwd: string, args: string[]): GitResult => {
    rawCalls.push(args)
    const question = stripConfigFlags(args)
    calls.push(question)
    return map[question.join(' ')] ?? ok('')
  }) as GitRunner & { calls: string[][]; rawCalls: string[][] }
  runner.calls = calls
  runner.rawCalls = rawCalls
  return runner
}

const TARGET: ReviewTarget = {
  conversationId: 'c1',
  title: 'Fix the thing',
  cwd: '/repo',
  branch: 'feature/thing',
  tool: 'claude'
}

describe('reviewSummary', () => {
  it('reports a clean tree as no changes', () => {
    const git = fakeGit({ 'rev-parse --is-inside-work-tree': ok('true\n') })
    const s = reviewSummary(git, TARGET)
    expect(s.error).toBeNull()
    expect(s.files).toBe(0)
    expect(s.insertions).toBe(0)
    expect(s.deletions).toBe(0)
    expect(s.entries).toEqual([])
  })

  it('sums tracked changes from numstat', () => {
    const git = fakeGit({
      'rev-parse --is-inside-work-tree': ok('true\n'),
      'diff HEAD --numstat': ok('3\t1\tsrc/a.ts\n0\t7\tsrc/b.ts\n')
    })
    const s = reviewSummary(git, TARGET)
    expect(s.files).toBe(2)
    expect(s.insertions).toBe(3)
    expect(s.deletions).toBe(8)
  })

  it('includes untracked files, which is where an agent leaves new work', () => {
    const git = fakeGit({
      'rev-parse --is-inside-work-tree': ok('true\n'),
      'diff HEAD --numstat': ok('1\t0\tsrc/a.ts\n'),
      'ls-files --others --exclude-standard': ok('src/new.ts\n'),
      // git exits 1 from --no-index when the files differ; that is success here.
      'diff --no-index --numstat /dev/null src/new.ts': { code: 1, stdout: '5\t0\tsrc/new.ts\n', stderr: '' }
    })
    const s = reviewSummary(git, TARGET)
    expect(s.files).toBe(2)
    expect(s.insertions).toBe(6)
    expect(s.entries.find((e) => e.path === 'src/new.ts')?.untracked).toBe(true)
  })

  it('marks tracked entries as not untracked', () => {
    const git = fakeGit({
      'rev-parse --is-inside-work-tree': ok('true\n'),
      'diff HEAD --numstat': ok('1\t0\tsrc/a.ts\n')
    })
    expect(reviewSummary(git, TARGET).entries[0].untracked).toBe(false)
  })

  it('caps untracked files and says how many it dropped', () => {
    const many = Array.from({ length: UNTRACKED_CAP + 5 }, (_, i) => `f${i}.ts`).join('\n')
    const git = fakeGit({
      'rev-parse --is-inside-work-tree': ok('true\n'),
      'ls-files --others --exclude-standard': ok(many + '\n')
    })
    const s = reviewSummary(git, TARGET)
    expect(s.entries).toHaveLength(UNTRACKED_CAP)
    expect(s.untrackedTruncated).toBe(5)
  })

  it('reports a non-repo as an error rather than as no changes', () => {
    const git = fakeGit({
      'rev-parse --is-inside-work-tree': fail('fatal: not a git repository')
    })
    const s = reviewSummary(git, TARGET)
    expect(s.error).toMatch(/not a git repository/i)
    expect(s.files).toBe(0)
  })

  it('resolves the live branch, preferring it over the stored one', () => {
    const git = fakeGit({
      'rev-parse --is-inside-work-tree': ok('true\n'),
      'rev-parse --abbrev-ref HEAD': ok('actually-here\n')
    })
    expect(reviewSummary(git, TARGET).branch).toBe('actually-here')
  })

  it('falls back to the stored branch when git cannot name one', () => {
    const git = fakeGit({
      'rev-parse --is-inside-work-tree': ok('true\n'),
      'rev-parse --abbrev-ref HEAD': fail('fatal: bad revision')
    })
    expect(reviewSummary(git, TARGET).branch).toBe('feature/thing')
  })

  it('reports a detached HEAD as detached rather than as the branch "HEAD"', () => {
    const git = fakeGit({
      'rev-parse --is-inside-work-tree': ok('true\n'),
      'rev-parse --abbrev-ref HEAD': ok('HEAD\n')
    })
    expect(reviewSummary(git, TARGET).branch).toBe('detached')
  })

  it('carries the conversation identity through untouched', () => {
    const git = fakeGit({ 'rev-parse --is-inside-work-tree': ok('true\n') })
    const s = reviewSummary(git, TARGET)
    expect(s.conversationId).toBe('c1')
    expect(s.title).toBe('Fix the thing')
    expect(s.cwd).toBe('/repo')
  })
})

describe('groupTargetsByTree', () => {
  const t = (id: string, cwd: string, branch: string | null = null): ReviewTarget => ({
    conversationId: id,
    title: `t-${id}`,
    cwd,
    branch,
    tool: 'claude'
  })

  it('collapses two sessions on one folder into a single tree', () => {
    const groups = groupTargetsByTree([t('a', '/repo'), t('b', '/repo')])
    expect(groups).toHaveLength(1)
    expect(groups[0].sessions.map((s) => s.conversationId)).toEqual(['a', 'b'])
  })

  it('keeps a worktree session separate, because its cwd differs', () => {
    const groups = groupTargetsByTree([t('a', '/repo'), t('b', '/worktrees/repo-feature')])
    expect(groups.map((g) => g.cwd)).toEqual(['/repo', '/worktrees/repo-feature'])
  })

  it('takes the first non-null branch across a tree', () => {
    const groups = groupTargetsByTree([t('a', '/repo', null), t('b', '/repo', 'feature/x')])
    expect(groups[0].branch).toBe('feature/x')
  })

  it('drops targets with no folder rather than grouping them under empty string', () => {
    expect(groupTargetsByTree([t('a', '')])).toEqual([])
  })

  it('preserves first-seen order', () => {
    const groups = groupTargetsByTree([t('a', '/z'), t('b', '/a'), t('c', '/z')])
    expect(groups.map((g) => g.cwd)).toEqual(['/z', '/a'])
  })
})

describe('reviewDiff', () => {
  it('parses the whole working diff when given no path', () => {
    const git = fakeGit({
      'rev-parse --is-inside-work-tree': ok('true\n'),
      'diff HEAD --': ok(`diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@ -1,1 +1,1 @@
-a
+b
`)
    })
    const r = reviewDiff(git, '/repo', null)
    expect(r.error).toBeNull()
    expect(r.files).toHaveLength(1)
    expect(r.files[0].path).toBe('x.ts')
  })

  it('scopes to one path when given one', () => {
    const git = fakeGit({ 'rev-parse --is-inside-work-tree': ok('true\n') })
    reviewDiff(git, '/repo', 'src/a.ts')
    expect(git.calls).toContainEqual(['diff', 'HEAD', '--', 'src/a.ts'])
  })

  it('reads an untracked path through --no-index, since HEAD has nothing to diff', () => {
    const git = fakeGit({
      'rev-parse --is-inside-work-tree': ok('true\n'),
      'diff HEAD -- src/new.ts': ok(''),
      'diff --no-index -- /dev/null src/new.ts': {
        code: 1,
        stdout: `diff --git a/dev/null b/src/new.ts
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,1 @@
+fresh
`,
        stderr: ''
      }
    })
    const r = reviewDiff(git, '/repo', 'src/new.ts')
    expect(r.files).toHaveLength(1)
    expect(r.files[0].status).toBe('added')
    expect(r.files[0].insertions).toBe(1)
  })

  it('reports a non-repo as an error', () => {
    const git = fakeGit({ 'rev-parse --is-inside-work-tree': fail('fatal: not a git repository') })
    expect(reviewDiff(git, '/nope', null).error).toMatch(/not a git repository/i)
  })

  it('surfaces a git failure rather than pretending the diff was empty', () => {
    const git = fakeGit({
      'rev-parse --is-inside-work-tree': ok('true\n'),
      'diff HEAD --': fail('fatal: bad object HEAD', 128)
    })
    const r = reviewDiff(git, '/repo', null)
    expect(r.error).toMatch(/bad object/i)
    expect(r.files).toEqual([])
  })
})

// Path handling that broke on real repos.
describe('review-service — path handling', () => {
  it('turns off git path quoting on EVERY call', () => {
    // With the default core.quotepath=true, a non-ASCII filename comes back
    // C-quoted ("utf8\303\261.txt"); handing that back to `git diff -- <path>`
    // matches nothing, so a file with real changes showed an empty diff.
    const git = fakeGit({ 'rev-parse --is-inside-work-tree': ok('true\n') })
    reviewSummary(git, TARGET)
    expect(git.rawCalls.length).toBeGreaterThan(0)
    for (const args of git.rawCalls) {
      expect(args.slice(0, 2)).toEqual(['-c', 'core.quotepath=off'])
    }
  })

  it('turns it off for the diff call too', () => {
    const git = fakeGit({ 'rev-parse --is-inside-work-tree': ok('true\n') })
    reviewDiff(git, '/repo', 'src/a.ts')
    for (const args of git.rawCalls) {
      expect(args.slice(0, 2)).toEqual(['-c', 'core.quotepath=off'])
    }
  })

  it('keeps a non-ASCII filename intact end to end', () => {
    const git = fakeGit({
      'rev-parse --is-inside-work-tree': ok('true\n'),
      'diff HEAD --numstat': ok('1\t0\tutf8ñ.txt\n')
    })
    expect(reviewSummary(git, TARGET).entries[0].path).toBe('utf8ñ.txt')
  })
})
