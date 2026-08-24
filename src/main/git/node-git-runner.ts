import { execFile } from 'node:child_process'
import type { GitRunner, GitResult } from './git-runner'

// The ONLY module that shells real git. Never import it from a test — tests
// drive the service layer with a fake GitRunner (mirrors node-pty-spawner.ts).
// `git` is expected on PATH; on a GUI-launched macOS app the PATH is repaired by
// applyFixedPath() (env/fix-path.ts) before any spawn, which covers this too.

// A whole-tree `git diff` easily exceeds Node's DEFAULT 1MB buffer, and
// exceeding it does not truncate — the call fails outright with ENOBUFS and a
// null exit status. That made a large review silently unreadable: the tab
// showed "spawnSync git ENOBUFS" instead of the diff. 32MB is past any diff a
// human is going to read, and the process is bounded by the timeout anyway.
export const MAX_GIT_OUTPUT_BYTES = 32 * 1024 * 1024

const TIMEOUT_MS = 15_000

export const nodeGitRunner: GitRunner = (cwd, args) =>
  new Promise<GitResult>((resolve) => {
    execFile(
      'git',
      ['-C', cwd, ...args],
      { encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: MAX_GIT_OUTPUT_BYTES, windowsHide: true },
      (err, stdout, stderr) => {
        if (!err) {
          resolve({ code: 0, stdout, stderr: stderr ?? '' })
          return
        }
        // A non-zero git (a collision, a dirty tree, not a repo) is DATA here,
        // not a crash: the service inspects the status and streams.
        //
        // Note the field: async execFile reports the exit status on `code`,
        // where the sync version used `status`. On a signal kill or a spawn
        // failure `code` is a string like 'ENOENT'/'ETIMEDOUT' or undefined,
        // so anything non-numeric collapses to 1.
        const e = err as NodeJS.ErrnoException & { code?: number | string; killed?: boolean }
        const numeric = typeof e.code === 'number' ? e.code : 1
        const detail = e.killed
          ? `git timed out after ${TIMEOUT_MS / 1000}s`
          : (stderr ?? '') || e.message || 'git failed'
        resolve({ code: numeric, stdout: stdout ?? '', stderr: detail })
      }
    )
  })
