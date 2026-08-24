import { spawn } from 'node:child_process'
import type { GateCommandRunner } from './gate-service'
import type { GateRun } from './gate-result'

// The ONLY module that spawns a gate. Never import this from a test — tests
// drive createGateService with a fake GateCommandRunner (mirrors
// node-git-runner.ts and node-pty-spawner.ts).
//
// The gate runs in a CHILD PROCESS, deliberately: a gate that hangs, crashes, or
// eats memory cannot reach the ptys held in main, which are the running agent
// sessions this app exists to protect.

// Output is kept for on-demand display, not streamed, so it must be bounded. The
// TAIL is what survives: test runners put their tally at the end.
const MAX_CAPTURE = 512 * 1024

function keepTail(chunks: string[], incoming: string): void {
  chunks.push(incoming)
  let total = chunks.reduce((n, c) => n + c.length, 0)
  while (total > MAX_CAPTURE && chunks.length > 1) {
    total -= chunks[0].length
    chunks.shift()
  }
}

export const nodeGateRunner: GateCommandRunner = (command, cwd, timeoutMs): Promise<GateRun> => {
  return new Promise<GateRun>((resolve) => {
    const startedAt = Date.now()
    const out: string[] = []
    const err: string[] = []
    let settled = false

    // shell:true so a configured gate can be a real command line ("pnpm test",
    // "make check && ./verify.sh") rather than a pre-split argv. This executes a
    // string from the user's own config file in their own repo, which is the
    // same trust level as the CLI tools the app already launches.
    const child = spawn(command, { cwd, shell: true, windowsHide: true })

    const finish = (code: number | null, timedOut: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        code,
        stdout: out.join(''),
        stderr: err.join(''),
        durationMs: Date.now() - startedAt,
        timedOut
      })
    }

    const timer = setTimeout(() => {
      // SIGKILL rather than SIGTERM: a wedged test runner is exactly the thing
      // that ignores a polite signal, and the timeout has already been generous.
      child.kill('SIGKILL')
      finish(null, true)
    }, timeoutMs)

    child.stdout?.on('data', (d: Buffer) => keepTail(out, d.toString()))
    child.stderr?.on('data', (d: Buffer) => keepTail(err, d.toString()))

    // A command that cannot be spawned at all (ENOENT, bad cwd) reports its
    // reason as stderr with a null code, which resolveGate reads as `error`.
    child.on('error', (e: Error) => {
      keepTail(err, e.message)
      finish(null, false)
    })
    child.on('close', (code) => finish(code, false))
  })
}
