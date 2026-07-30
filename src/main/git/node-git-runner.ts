import { execFileSync } from 'node:child_process'
import type { GitRunner, GitResult } from './git-runner'

// The ONLY module that shells real git. Never import this from a test — tests
// drive the service layer with a fake GitRunner (mirrors node-pty-spawner.ts).
// `git` is expected on PATH; on a GUI-launched macOS app the PATH is repaired by
// applyFixedPath() (env/fix-path.ts) before any spawn, which covers this too.
export const nodeGitRunner: GitRunner = (cwd, args): GitResult => {
  try {
    const stdout = execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      timeout: 15000,
      // git worktree ops can print progress to stderr; capture, don't inherit.
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return { code: 0, stdout, stderr: '' }
  } catch (err) {
    // execFileSync throws on a non-zero exit (a collision, a dirty tree, no repo).
    // That is data, not a crash: surface the captured status + streams so the
    // service can inspect them. status is null when git itself never ran (ENOENT).
    const e = err as { status?: number | null; stdout?: string | Buffer; stderr?: string | Buffer; message?: string }
    const stderr = e.stderr ? String(e.stderr) : (e.message ?? 'git failed')
    return { code: typeof e.status === 'number' ? e.status : 1, stdout: e.stdout ? String(e.stdout) : '', stderr }
  }
}
