import { describe, it, expect } from 'vitest'
import { gitRepoInfo, createWorktree, removeWorktree } from './worktree-service'
import type { GitRunner, GitResult } from './git-runner'

// A fake GitRunner: records every invocation and replies from a scripted map keyed
// by the first git subcommand. No real git is ever shelled.
function fakeRunner(replies: Record<string, GitResult>): GitRunner & { calls: { cwd: string; args: string[] }[] } {
  const calls: { cwd: string; args: string[] }[] = []
  const fn = ((cwd: string, args: string[]): GitResult => {
    calls.push({ cwd, args })
    const key = `${args[0]} ${args[1] ?? ''}`.trim()
    return replies[key] ?? replies[args[0]] ?? { code: 0, stdout: '', stderr: '' }
  }) as GitRunner & { calls: { cwd: string; args: string[] }[] }
  fn.calls = calls
  return fn
}

describe('gitRepoInfo', () => {
  it('is a repo when rev-parse prints true', () => {
    const r = fakeRunner({ 'rev-parse --is-inside-work-tree': { code: 0, stdout: 'true\n', stderr: '' } })
    expect(gitRepoInfo(r, '/x').isRepo).toBe(true)
  })
  it('is not a repo on a non-zero exit', () => {
    const r = fakeRunner({ 'rev-parse --is-inside-work-tree': { code: 128, stdout: '', stderr: 'not a git repository' } })
    expect(gitRepoInfo(r, '/x').isRepo).toBe(false)
  })
})

describe('createWorktree', () => {
  it('runs "worktree add -b <branch> <path> HEAD" and returns the path', () => {
    const r = fakeRunner({ 'worktree add': { code: 0, stdout: '', stderr: '' } })
    const res = createWorktree(r, { configDir: '/cfg', folder: '/repo', repoKey: 'repo', branch: 'hardy/add-thing' })
    expect(res).toEqual({ ok: true, worktreePath: expect.stringContaining('worktrees'), branch: 'hardy/add-thing' })
    const call = r.calls[0]
    expect(call.cwd).toBe('/repo')
    expect(call.args.slice(0, 4)).toEqual(['worktree', 'add', '-b', 'hardy/add-thing'])
    expect(call.args.at(-1)).toBe('HEAD') // base off HEAD
    expect(call.args[4].replace(/\\/g, '/')).toBe('/cfg/worktrees/repo/hardy-add-thing')
  })
  it('sanitizes the branch before use (empty -> task)', () => {
    const r = fakeRunner({ 'worktree add': { code: 0, stdout: '', stderr: '' } })
    const res = createWorktree(r, { configDir: '/cfg', folder: '/repo', repoKey: 'repo', branch: '' })
    expect(res.ok && res.branch).toBe('task')
    expect(r.calls[0].args[3]).toBe('task')
  })
  it('maps a branch-exists collision to a clear error, cleaned of the git prefix', () => {
    const r = fakeRunner({ 'worktree add': { code: 128, stdout: '', stderr: "fatal: a branch named 'x' already exists\n" } })
    const res = createWorktree(r, { configDir: '/cfg', folder: '/repo', repoKey: 'repo', branch: 'x' })
    expect(res).toEqual({ ok: false, error: "a branch named 'x' already exists" })
  })
  it('maps a path-exists collision to git\'s message', () => {
    const r = fakeRunner({ 'worktree add': { code: 128, stdout: '', stderr: "fatal: '/cfg/worktrees/repo/x' already exists\n" } })
    const res = createWorktree(r, { configDir: '/cfg', folder: '/repo', repoKey: 'repo', branch: 'x' })
    expect(res.ok).toBe(false)
    expect(!res.ok && res.error).toContain('already exists')
  })
})

describe('removeWorktree', () => {
  it('runs "worktree remove <path>" WITHOUT --force', () => {
    const r = fakeRunner({ 'worktree remove': { code: 0, stdout: '', stderr: '' } })
    const res = removeWorktree(r, { folder: '/repo', worktreePath: '/cfg/worktrees/repo/x' })
    expect(res).toEqual({ ok: true })
    expect(r.calls[0].args).toEqual(['worktree', 'remove', '/cfg/worktrees/repo/x'])
    expect(r.calls[0].args).not.toContain('--force')
  })
  it('refuses a dirty tree with a plain message, never leaking "use --force"', () => {
    const r = fakeRunner({
      'worktree remove': { code: 128, stdout: '', stderr: "fatal: '/x' contains modified or untracked files, use --force to delete it\n" }
    })
    const res = removeWorktree(r, { folder: '/repo', worktreePath: '/x' })
    expect(res).toEqual({ ok: false, error: 'worktree has uncommitted changes; not removed' })
    expect(!res.ok && res.error).not.toContain('--force')
  })
  it('surfaces any other git error, cleaned', () => {
    const r = fakeRunner({ 'worktree remove': { code: 1, stdout: '', stderr: 'error: something else\n' } })
    const res = removeWorktree(r, { folder: '/repo', worktreePath: '/x' })
    expect(res).toEqual({ ok: false, error: 'something else' })
  })
})
