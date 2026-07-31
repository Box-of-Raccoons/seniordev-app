import { join } from 'node:path'

// Pure branch-name helpers live in shared/ (no node deps) so the renderer's
// composer can use them too; re-exported here for the main-side call sites and the
// existing git tests.
export { slugifyForBranch, sanitizeBranchRef } from '../../shared/branch'
import { sanitizeBranchRef } from '../../shared/branch'

// The result of one git invocation. `code` is the process exit status (0 = ok);
// stdout/stderr are captured verbatim. The runner never throws — a non-zero git
// (a collision, a dirty tree) is a value the service inspects, not an exception.
export interface GitResult {
  code: number
  stdout: string
  stderr: string
}

// Injectable git seam, mirroring PtySpawner (terminal/manager.ts): the service
// layer takes a GitRunner so tests drive it with a fake and never shell real git.
// The one real implementation is node-git-runner.ts (the only child_process-for-git
// module). `cwd` is the -C target; `args` are the git arguments (no leading "git").
export type GitRunner = (cwd: string, args: string[]) => GitResult

// The single path segment a branch becomes on disk: '/' flattened to '-' so a
// prefixed branch (feature/foo) lands in one directory rather than nesting under
// the worktrees base. The branch NAME keeps its slashes; only the path is flat.
export function worktreePathSegment(branch: string): string {
  return branch.replace(/\//g, '-')
}

// Where a worktree lives: <configDir>/worktrees/<repoKey>/<branch-segment>.
// repoKey is sanitized to a safe single directory segment (a configured repo key
// or a folder basename). Built with node:path so it resolves per-platform
// (POSIX and Windows alike).
export function worktreePathFor(configDir: string, repoKey: string, branch: string): string {
  const keySeg = repoKey.replace(/[\\/]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'repo'
  return join(configDir, 'worktrees', keySeg, worktreePathSegment(branch))
}
