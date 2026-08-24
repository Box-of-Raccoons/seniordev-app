import { describe, it, expect } from 'vitest'
import { resolveGate, gateSummary, SUMMARY_MAX } from './gate-result'

describe('resolveGate', () => {
  it('calls exit 0 a pass', () => {
    expect(resolveGate({ code: 0, stdout: 'ok', stderr: '', durationMs: 10 }).outcome).toBe('pass')
  })

  it('calls a non-zero exit a fail', () => {
    const r = resolveGate({ code: 1, stdout: '', stderr: 'boom', durationMs: 10 })
    expect(r.outcome).toBe('fail')
    expect(r.code).toBe(1)
  })

  it('calls a null exit an error, not a fail', () => {
    // A null code means the command never ran or was killed (timeout, ENOENT).
    // That is a broken gate, not a failing test suite, and saying "fail" would
    // report the code as bad when the harness is what broke.
    const r = resolveGate({ code: null, stdout: '', stderr: 'spawn ENOENT', durationMs: 5 })
    expect(r.outcome).toBe('error')
  })

  it('marks a timeout as an error and says so', () => {
    const r = resolveGate({ code: null, stdout: '', stderr: '', durationMs: 1000, timedOut: true })
    expect(r.outcome).toBe('error')
    expect(r.summary).toMatch(/timed out/i)
  })

  it('keeps the duration and the whole output', () => {
    const r = resolveGate({ code: 0, stdout: 'a\nb', stderr: 'c', durationMs: 42 })
    expect(r.durationMs).toBe(42)
    expect(r.output).toContain('a\nb')
    expect(r.output).toContain('c')
  })
})

describe('gateSummary', () => {
  it('prefers a test-runner tally line when there is one', () => {
    const out = ['some noise', '  Tests  1114 passed (1114)', 'Duration 7s'].join('\n')
    expect(gateSummary(out, '', 0)).toBe('Tests  1114 passed (1114)')
  })

  it('finds a tally reporting failures too', () => {
    const out = ' Tests  2 failed | 12 passed (14)'
    expect(gateSummary(out, '', 1)).toBe('Tests  2 failed | 12 passed (14)')
  })

  it('falls back to the last meaningful line on a failure', () => {
    const out = 'compiling\nsrc/a.ts(3,1): error TS2304: Cannot find name x\n\n'
    expect(gateSummary(out, '', 2)).toBe('src/a.ts(3,1): error TS2304: Cannot find name x')
  })

  it('reads stderr when stdout said nothing', () => {
    expect(gateSummary('', 'command not found: pnpm', 127)).toBe('command not found: pnpm')
  })

  it('says passed when a clean run printed nothing at all', () => {
    expect(gateSummary('', '', 0)).toBe('passed')
  })

  it('names the exit code when a failure printed nothing', () => {
    expect(gateSummary('', '', 3)).toBe('failed (exit 3)')
  })

  it('truncates a very long line rather than pushing it onto the tab', () => {
    const long = 'x'.repeat(SUMMARY_MAX + 50)
    const s = gateSummary(long, '', 1)
    expect(s.length).toBeLessThanOrEqual(SUMMARY_MAX)
    expect(s.endsWith('…')).toBe(true)
  })

  it('strips ANSI colour so the tab shows text, not escape codes', () => {
    const coloured = '[32m Tests  3 passed (3)[0m'
    expect(gateSummary(coloured, '', 0)).toBe('Tests  3 passed (3)')
  })
})
