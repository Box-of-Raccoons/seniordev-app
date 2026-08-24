import { sanitizeBranchRef, worktreePathFor, type GitRunner } from './git-runner'

// S5 worktree isolation (spec section 9). All git runs through an injected
// GitRunner so this layer is pure of child_process and fully testable with a fake.
// Nothing here is stored: git identity is resolved live (spec section 4.3).

// Trim git's "fatal: " / "error: " prefix so a surfaced message reads as a plain
// sentence in the UI, not a raw git line.
function cleanGitError(stderr: string): string {
  return stderr.trim().replace(/^(fatal|error):\s*/i, '')
}

// Is `folder` inside a git work tree? Drives the composer's checkbox enable state.
// A non-zero exit (not a repo, git missing) is a clean `false`, never an error.
export async function gitRepoInfo(runner: GitRunner, folder: string): Promise<{ isRepo: boolean }> {
  try {
    const r = await runner(folder, ['rev-parse', '--is-inside-work-tree'])
    return { isRepo: r.code === 0 && r.stdout.trim() === 'true' }
  } catch {
    return { isRepo: false }
  }
}

export type CreateWorktreeResult =
  | { ok: true; worktreePath: string; branch: string }
  | { ok: false; error: string }

// Create a new branch + worktree off HEAD (spec section 9; a remote-tracking base
// is deferred). The branch is sanitized to a valid ref here too (defense in depth
// over the composer's own sanitize). A collision — the branch or the target path
// already exists — makes `git worktree add` exit non-zero; we map that to a clear
// message and return ok:false. We NEVER reuse an existing branch/path silently,
// so a failure can never spawn the agent in the wrong cwd.
export async function createWorktree(
  runner: GitRunner,
  opts: { configDir: string; folder: string; repoKey: string; branch: string }
): Promise<CreateWorktreeResult> {
  const branch = sanitizeBranchRef(opts.branch)
  const worktreePath = worktreePathFor(opts.configDir, opts.repoKey, branch)
  let r: { code: number; stderr: string }
  try {
    r = await runner(opts.folder, ['worktree', 'add', '-b', branch, worktreePath, 'HEAD'])
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  if (r.code === 0) return { ok: true, worktreePath, branch }
  const raw = cleanGitError(r.stderr)
  // git's own messages are already specific ("a branch named 'x' already exists",
  // "'<path>' already exists"); pass them through, cleaned. Fall back to a generic
  // line if git said nothing.
  return { ok: false, error: raw || `could not create worktree for branch '${branch}'` }
}

export type RemoveWorktreeResult = { ok: true } | { ok: false; error: string }

// Remove a worktree, MANUAL teardown only (spec section 9). Deliberately WITHOUT
// --force: git refuses to remove a worktree with modified or untracked files, so
// declining the flag is what stops us destroying an uncommitted diff. A refusal is
// surfaced, never swallowed and never overridden. Accumulating a stale worktree is
// preferable to losing work.
export async function removeWorktree(
  runner: GitRunner,
  opts: { folder: string; worktreePath: string }
): Promise<RemoveWorktreeResult> {
  let r: { code: number; stderr: string }
  try {
    r = await runner(opts.folder, ['worktree', 'remove', opts.worktreePath])
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  if (r.code === 0) return { ok: true }
  const raw = cleanGitError(r.stderr)
  // Don't leak git's "use --force" suggestion — forcing is exactly what we refuse
  // to do. Report the uncommitted-changes case plainly.
  if (/modified or untracked|contains modified/i.test(raw)) {
    return { ok: false, error: 'worktree has uncommitted changes; not removed' }
  }
  return { ok: false, error: raw || 'could not remove worktree' }
}
