import { describe, it, expect } from 'vitest'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { nodeGateRunner } from './node-gate-runner'
import { resolveGate } from './gate-result'

// This is the ONE file that imports the real spawner. Everywhere else drives
// createGateService with a fake GateCommandRunner, which means nothing else ever
// executes a command — so without this, "the gate runs your tests" would be a
// claim no test had checked. Commands go through `node -e` so they behave the
// same on macOS, Linux and Windows.
const node = (script: string): string => `node -e "${script}"`

describe('nodeGateRunner (real child processes)', () => {
  it('captures stdout and a zero exit from a passing command', async () => {
    const run = await nodeGateRunner(node("console.log('Tests  3 passed (3)')"), process.cwd(), 30_000)
    expect(run.code).toBe(0)
    expect(run.stdout).toContain('Tests  3 passed (3)')
    expect(run.timedOut).toBe(false)
    expect(resolveGate(run).outcome).toBe('pass')
  })

  it('reports a non-zero exit code verbatim', async () => {
    const run = await nodeGateRunner(node('process.exit(3)'), process.cwd(), 30_000)
    expect(run.code).toBe(3)
    expect(resolveGate(run).outcome).toBe('fail')
  })

  it('captures stderr as well as stdout', async () => {
    const run = await nodeGateRunner(node("console.error('boom'); process.exit(1)"), process.cwd(), 30_000)
    expect(run.stderr).toContain('boom')
    expect(resolveGate(run).summary).toContain('boom')
  })

  it('runs in the directory it is given', async () => {
    const run = await nodeGateRunner(node('console.log(process.cwd())'), process.cwd(), 30_000)
    expect(run.stdout.trim()).toBe(process.cwd())
  })

  it('kills a hung command at the timeout and flags it', async () => {
    const started = Date.now()
    const run = await nodeGateRunner(node('setTimeout(() => {}, 60000)'), process.cwd(), 400)
    expect(run.timedOut).toBe(true)
    expect(run.code).toBeNull()
    // Killed near the deadline rather than run to completion.
    expect(Date.now() - started).toBeLessThan(30_000)
    const r = resolveGate(run)
    expect(r.outcome).toBe('error')
    expect(r.summary).toMatch(/timed out/i)
  })

  it('reports a missing command as the shell does: a non-zero exit, not a spawn error', async () => {
    // Worth pinning: because the gate runs through a shell (so a configured gate
    // can be a real command line), a missing binary comes back as the SHELL's
    // non-zero exit, not as an ENOENT spawn error. So it resolves to `fail`, not
    // `error`, and the summary is what the shell printed.
    const run = await nodeGateRunner('definitely-not-a-real-command-xyz', process.cwd(), 30_000)
    expect(run.code).not.toBe(0)
    expect(run.code).not.toBeNull()
    expect(`${run.stderr}${run.stdout}`.toLowerCase()).toMatch(/not found|not recognized/)
  })

  it('measures how long the command took', async () => {
    const run = await nodeGateRunner(node('setTimeout(() => {}, 150)'), process.cwd(), 30_000)
    expect(run.durationMs).toBeGreaterThanOrEqual(100)
  })

  it('RESOLVES rather than hanging when the process cannot be spawned at all', async () => {
    // The failure this guards: if the `error` handler were missing, the promise
    // would never settle, the gate service's queue would stall on it, and NO
    // tab would ever gate again. A hang is invisible; a resolved error is not.
    const run = await nodeGateRunner(node("console.log('hi')"), '/no/such/directory/at/all', 30_000)
    expect(run.code).not.toBe(0)
    expect(resolveGate(run).outcome === 'error' || resolveGate(run).outcome === 'fail').toBe(true)
  })

  it('bounds captured output, keeping the TAIL where the tally lives', async () => {
    // 2MB of output against a 512KB cap. Unbounded capture would hold the lot
    // in main; truncating the wrong end would discard the summary line.
    const script = "for (let i = 0; i < 40000; i++) console.log('x'.repeat(50)); console.log('FINAL-TALLY-LINE')"
    const run = await nodeGateRunner(node(script), process.cwd(), 60_000)
    expect(run.stdout.length).toBeLessThan(2_000_000)
    expect(run.stdout).toContain('FINAL-TALLY-LINE')
    expect(resolveGate(run).summary).toContain('FINAL-TALLY-LINE')
  })

  it('leaves no orphaned grandchild behind when it times out', async () => {
    // The shell is not the test runner. Killing only `sh -c` leaves the real
    // process alive holding ports and test databases. The child writes its
    // grandchild's pid, then we check that pid is gone after the timeout.
    const marker = join(tmpdir(), `seniordev-gate-orphan-${process.pid}.pid`)
    const scriptFile = join(tmpdir(), `seniordev-gate-orphan-${process.pid}.js`)
    rmSync(marker, { force: true })
    // Written to a file rather than passed via `node -e`: the script contains
    // both quote kinds, and inlining it into a shell string mangles it.
    writeFileSync(
      scriptFile,
      [
        "const { spawn } = require('node:child_process')",
        "const fs = require('node:fs')",
        "const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
        `fs.writeFileSync(${JSON.stringify(marker)}, String(c.pid))`,
        'setInterval(() => {}, 1000)'
      ].join('\n')
    )
    const run = await nodeGateRunner(`node ${JSON.stringify(scriptFile)}`, process.cwd(), 1500)
    rmSync(scriptFile, { force: true })
    expect(run.timedOut).toBe(true)

    const pid = Number(readFileSync(marker, 'utf8'))
    rmSync(marker, { force: true })
    expect(Number.isFinite(pid)).toBe(true)
    // Give the kill a moment to propagate through the group.
    await new Promise((r) => setTimeout(r, 300))
    let alive = true
    try {
      process.kill(pid, 0) // signal 0 tests existence without killing
    } catch {
      alive = false
    }
    if (alive) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* best effort cleanup so a failing assertion does not leak a process */
      }
    }
    expect(alive).toBe(false)
  })
})
