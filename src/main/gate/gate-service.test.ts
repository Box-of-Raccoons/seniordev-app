import { describe, it, expect, vi } from 'vitest'
import { createGateService, type GateCommandRunner } from './gate-service'
import { ConfigSchema, type Config } from '../config/schema'
import type { GateResultEvent, GateRunningEvent } from '../../shared/ipc'

const cfg = (over: Record<string, unknown> = {}): Config => ConfigSchema.parse(over)

const PASSING: GateCommandRunner = async () => ({ code: 0, stdout: 'Tests  3 passed (3)', stderr: '', durationMs: 5 })

function setup(over?: { config?: Config; runner?: GateCommandRunner }) {
  const results: GateResultEvent[] = []
  const running: GateRunningEvent[] = []
  const svc = createGateService({
    getConfig: () => over?.config ?? cfg({ defaultGate: 'pnpm test' }),
    runner: over?.runner ?? PASSING,
    onResult: (e) => results.push(e),
    onRunning: (e) => running.push(e)
  })
  return { svc, results, running }
}

describe('gate service', () => {
  it('runs the gate when a tracked tab goes idle', async () => {
    const { svc, results } = setup()
    svc.track('p1', '/repo')
    await svc.onStatus({ id: 'p1', status: 'idle' })
    expect(results).toHaveLength(1)
    expect(results[0].outcome).toBe('pass')
    expect(results[0].summary).toBe('Tests  3 passed (3)')
  })

  it('announces the run before it finishes, so a slow gate is visible', async () => {
    const { svc, running } = setup()
    svc.track('p1', '/repo')
    await svc.onStatus({ id: 'p1', status: 'idle' })
    expect(running).toEqual([{ ptyId: 'p1', command: 'pnpm test' }])
  })

  it('does NOT run while a session is waiting on the human', async () => {
    // needsYou means the agent is sitting at a prompt. Its tree is mid-edit and a
    // gate there would report a false red on work that is not finished.
    const runner = vi.fn(PASSING)
    const { svc, results } = setup({ runner })
    svc.track('p1', '/repo')
    await svc.onStatus({ id: 'p1', status: 'needsYou' })
    expect(runner).not.toHaveBeenCalled()
    expect(results).toEqual([])
  })

  it('does not run while the session is still working', async () => {
    const runner = vi.fn(PASSING)
    const { svc } = setup({ runner })
    svc.track('p1', '/repo')
    await svc.onStatus({ id: 'p1', status: 'working' })
    expect(runner).not.toHaveBeenCalled()
  })

  it('does nothing for an untracked tab', async () => {
    const runner = vi.fn(PASSING)
    const { svc } = setup({ runner })
    await svc.onStatus({ id: 'ghost', status: 'idle' })
    expect(runner).not.toHaveBeenCalled()
  })

  it('does nothing before the config has loaded, rather than guessing a command', async () => {
    const runner = vi.fn(PASSING)
    const results: GateResultEvent[] = []
    const svc = createGateService({
      getConfig: () => null,
      runner,
      onResult: (e) => results.push(e),
      onRunning: () => {}
    })
    svc.track('p1', '/repo')
    await svc.onStatus({ id: 'p1', status: 'idle' })
    expect(runner).not.toHaveBeenCalled()
    expect(results).toEqual([])
  })

  it('does nothing when no gate is configured for the folder', async () => {
    const runner = vi.fn(PASSING)
    const { svc, results } = setup({ config: cfg(), runner })
    svc.track('p1', '/repo')
    await svc.onStatus({ id: 'p1', status: 'idle' })
    expect(runner).not.toHaveBeenCalled()
    expect(results).toEqual([])
  })

  it('runs the command in the tracked folder', async () => {
    const runner = vi.fn(PASSING)
    const { svc } = setup({ runner })
    svc.track('p1', '/some/where')
    await svc.onStatus({ id: 'p1', status: 'idle' })
    expect(runner).toHaveBeenCalledWith('pnpm test', '/some/where', 300_000)
  })

  it('reports a failing gate as fail, keeping the exit code', async () => {
    const runner: GateCommandRunner = async () => ({ code: 1, stdout: 'Tests  2 failed | 1 passed (3)', stderr: '', durationMs: 9 })
    const { svc, results } = setup({ runner })
    svc.track('p1', '/repo')
    await svc.onStatus({ id: 'p1', status: 'idle' })
    expect(results[0].outcome).toBe('fail')
  })

  it('reports a gate that could not run as error, not as fail', async () => {
    const runner: GateCommandRunner = async () => ({ code: null, stdout: '', stderr: 'spawn ENOENT', durationMs: 1 })
    const { svc, results } = setup({ runner })
    svc.track('p1', '/repo')
    await svc.onStatus({ id: 'p1', status: 'idle' })
    expect(results[0].outcome).toBe('error')
  })

  it('survives a runner that throws, reporting an error rather than crashing main', async () => {
    const runner: GateCommandRunner = async () => {
      throw new Error('spawn exploded')
    }
    const { svc, results } = setup({ runner })
    svc.track('p1', '/repo')
    await svc.onStatus({ id: 'p1', status: 'idle' })
    expect(results[0].outcome).toBe('error')
    expect(results[0].summary).toContain('spawn exploded')
  })

  it('SERIALISES gates: four sessions settling do not launch four suites at once', async () => {
    let inFlight = 0
    let peak = 0
    const runner: GateCommandRunner = async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return { code: 0, stdout: 'ok', stderr: '', durationMs: 5 }
    }
    const { svc, results } = setup({ runner })
    for (const id of ['a', 'b', 'c', 'd']) svc.track(id, `/repo/${id}`)
    await Promise.all(['a', 'b', 'c', 'd'].map((id) => svc.onStatus({ id, status: 'idle' })))
    expect(peak).toBe(1)
    expect(results).toHaveLength(4)
  })

  it('does not queue a second run for a tab already queued', async () => {
    const runner = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5))
      return { code: 0, stdout: 'ok', stderr: '', durationMs: 5 }
    }) as GateCommandRunner
    const { svc } = setup({ runner })
    svc.track('p1', '/repo')
    svc.track('p2', '/repo2')
    // p1 settles twice while p2's gate holds the queue.
    await Promise.all([
      svc.onStatus({ id: 'p2', status: 'idle' }),
      svc.onStatus({ id: 'p1', status: 'idle' }),
      svc.onStatus({ id: 'p1', status: 'idle' })
    ])
    expect((runner as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2)
  })

  it('drops a queued run when its tab is closed before it starts', async () => {
    const runner = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5))
      return { code: 0, stdout: 'ok', stderr: '', durationMs: 5 }
    }) as GateCommandRunner
    const { svc } = setup({ runner })
    svc.track('p1', '/repo')
    svc.track('p2', '/repo2')
    const runs = Promise.all([svc.onStatus({ id: 'p1', status: 'idle' }), svc.onStatus({ id: 'p2', status: 'idle' })])
    svc.untrack('p2')
    await runs
    // Only p1's gate ran; p2 was closed while queued.
    expect((runner as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
  })

  it('keeps the full output retrievable without pushing it through the event', async () => {
    const runner: GateCommandRunner = async () => ({
      code: 1,
      stdout: 'NOISY-EARLY-LINE\nmore noise\n Tests  1 failed | 2 passed (3)',
      stderr: '',
      durationMs: 3
    })
    const { svc, results } = setup({ runner })
    svc.track('p1', '/repo')
    await svc.onStatus({ id: 'p1', status: 'idle' })
    // The event carries the tally line only; the noise above it does not ride along.
    expect(results[0].summary).toBe('Tests  1 failed | 2 passed (3)')
    expect(JSON.stringify(results[0])).not.toContain('NOISY-EARLY-LINE')
    expect(svc.outputFor('p1')).toContain('NOISY-EARLY-LINE')
  })

  it('forgets a tab entirely on untrack', async () => {
    const { svc } = setup()
    svc.track('p1', '/repo')
    await svc.onStatus({ id: 'p1', status: 'idle' })
    svc.untrack('p1')
    expect(svc.outputFor('p1')).toBeNull()
  })
})

// Lifecycle and failure-isolation cases the first pass missed.
describe('gate service — queue resilience', () => {
  it('RUNS AGAIN when the same tab settles a second time after completing', async () => {
    // Mutation this kills: dropping `queued.delete(ptyId)` at the top of
    // execute. The first run works and every later settle is silently swallowed.
    const runner = vi.fn(PASSING)
    const { svc, results } = setup({ runner })
    svc.track('p1', '/repo')
    await svc.onStatus({ id: 'p1', status: 'idle' })
    await svc.onStatus({ id: 'p1', status: 'idle' })
    expect((runner as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2)
    expect(results).toHaveLength(2)
  })

  it('reports nothing for a tab closed WHILE its gate was running', async () => {
    const { svc, results } = setup({
      runner: async () => {
        await new Promise((r) => setTimeout(r, 5))
        return { code: 0, stdout: 'ok', stderr: '', durationMs: 5 }
      }
    })
    svc.track('p1', '/repo')
    const run = svc.onStatus({ id: 'p1', status: 'idle' })
    svc.untrack('p1')
    await run
    expect(results).toEqual([])
  })

  it('SURVIVES a reporting sink that throws, and keeps running later gates', async () => {
    // The real case: onResult reaches Electron's webContents, which throws
    // "Object has been destroyed" if the window closed mid-run. Without a catch
    // on the chain, that rejection poisons it and NO tab ever gates again.
    const results: GateResultEvent[] = []
    let first = true
    const svc = createGateService({
      getConfig: () => cfg({ defaultGate: 'pnpm test' }),
      runner: PASSING,
      onResult: (e) => {
        if (first) {
          first = false
          throw new Error('Object has been destroyed')
        }
        results.push(e)
      },
      onRunning: () => {}
    })
    svc.track('p1', '/repo')
    svc.track('p2', '/repo2')
    await svc.onStatus({ id: 'p1', status: 'idle' }).catch(() => {})
    await svc.onStatus({ id: 'p2', status: 'idle' })
    // The second tab's gate still ran and still reported.
    expect(results.map((r) => r.ptyId)).toEqual(['p2'])
  })

  it('survives a throwing onRunning sink too', async () => {
    const results: GateResultEvent[] = []
    let first = true
    const svc = createGateService({
      getConfig: () => cfg({ defaultGate: 'pnpm test' }),
      runner: PASSING,
      onResult: (e) => results.push(e),
      onRunning: () => {
        if (first) {
          first = false
          throw new Error('window gone')
        }
      }
    })
    svc.track('p1', '/repo')
    svc.track('p2', '/repo2')
    await svc.onStatus({ id: 'p1', status: 'idle' }).catch(() => {})
    await svc.onStatus({ id: 'p2', status: 'idle' })
    expect(results.map((r) => r.ptyId)).toEqual(['p2'])
  })
})
