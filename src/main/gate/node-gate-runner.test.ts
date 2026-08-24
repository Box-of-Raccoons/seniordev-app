import { describe, it, expect } from 'vitest'
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
})
