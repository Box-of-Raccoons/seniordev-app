import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useGates, gateGlyph, gateLabel } from './useGates'
import type { GateResultEvent, GateRunningEvent } from '../../../shared/ipc'

type Cb<T> = (e: T) => void

function stubApi(): { running: Cb<GateRunningEvent>[]; result: Cb<GateResultEvent>[]; offCalls: number } {
  const running: Cb<GateRunningEvent>[] = []
  const result: Cb<GateResultEvent>[] = []
  const state = { running, result, offCalls: 0 }
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
    onGateRunning: (cb: Cb<GateRunningEvent>) => {
      running.push(cb)
      return () => {
        state.offCalls++
      }
    },
    onGateResult: (cb: Cb<GateResultEvent>) => {
      result.push(cb)
      return () => {
        state.offCalls++
      }
    },
    gateOutput: vi.fn(async () => 'full output'),
    runGate: vi.fn(async () => undefined)
  }
  return state
}

const RESULT: GateResultEvent = {
  ptyId: 'p1',
  outcome: 'pass',
  summary: 'Tests  3 passed (3)',
  durationMs: 1200,
  command: 'pnpm test'
}

beforeEach(() => {
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = {}
})

describe('useGates', () => {
  it('has nothing for a tab that has never gated', () => {
    stubApi()
    const g = useGates()
    expect(g.forTab('p1')).toBeNull()
  })

  it('marks a tab as running when the gate starts', () => {
    const s = stubApi()
    const g = useGates()
    s.running[0]({ ptyId: 'p1', command: 'pnpm test' })
    expect(g.forTab('p1')?.state).toBe('running')
    expect(g.forTab('p1')?.command).toBe('pnpm test')
  })

  it('replaces running with the result when it finishes', () => {
    const s = stubApi()
    const g = useGates()
    s.running[0]({ ptyId: 'p1', command: 'pnpm test' })
    s.result[0](RESULT)
    const e = g.forTab('p1')
    expect(e?.state).toBe('pass')
    expect(e?.summary).toBe('Tests  3 passed (3)')
    expect(e?.durationMs).toBe(1200)
  })

  it('keeps tabs independent', () => {
    const s = stubApi()
    const g = useGates()
    s.result[0](RESULT)
    s.result[0]({ ...RESULT, ptyId: 'p2', outcome: 'fail', summary: '1 failed' })
    expect(g.forTab('p1')?.state).toBe('pass')
    expect(g.forTab('p2')?.state).toBe('fail')
  })

  it('a rerun clears the previous result rather than showing a stale one', () => {
    const s = stubApi()
    const g = useGates()
    s.result[0](RESULT)
    s.running[0]({ ptyId: 'p1', command: 'pnpm test' })
    expect(g.forTab('p1')?.state).toBe('running')
    expect(g.forTab('p1')?.summary).toBe('')
  })

  it('forgets a tab on request, so a closed tab leaves no badge behind', () => {
    const s = stubApi()
    const g = useGates()
    s.result[0](RESULT)
    g.forget('p1')
    expect(g.forTab('p1')).toBeNull()
  })

  it('unsubscribes both listeners on dispose', () => {
    const s = stubApi()
    const g = useGates()
    g.dispose()
    expect(s.offCalls).toBe(2)
  })
})

describe('gate glyph and label', () => {
  it('gives each state a distinct glyph, so colour is never the only signal', () => {
    const glyphs = (['running', 'pass', 'fail', 'error'] as const).map(gateGlyph)
    expect(new Set(glyphs).size).toBe(4)
    expect(glyphs.every((g) => g.length > 0)).toBe(true)
  })

  it('spells out each state for assistive tech', () => {
    expect(gateLabel({ state: 'pass', summary: 'Tests 3 passed', command: 'pnpm test', durationMs: 1000 })).toMatch(/passed/i)
    expect(gateLabel({ state: 'fail', summary: '1 failed', command: 'pnpm test', durationMs: 0 })).toMatch(/failed/i)
    expect(gateLabel({ state: 'running', summary: '', command: 'pnpm test', durationMs: 0 })).toMatch(/running/i)
  })

  it("an error says the gate broke, not that the code failed", () => {
    const label = gateLabel({ state: 'error', summary: 'command not found', command: 'pnpm test', durationMs: 0 })
    expect(label).toMatch(/gate/i)
    expect(label).not.toMatch(/\bfailed\b/i)
  })

  it('names the command in the label, so an unexpected gate is identifiable', () => {
    expect(gateLabel({ state: 'pass', summary: 'ok', command: 'make check', durationMs: 0 })).toContain('make check')
  })
})
