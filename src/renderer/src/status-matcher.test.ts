import { describe, it, expect } from 'vitest'
import { readBufferText, normalizeForStability, stepIdle, initialIdleState, type ScanBuffer } from './status-matcher'

// A fake xterm buffer: `lines` are the rows from baseY downward.
function fakeBuffer(lines: string[], baseY = 0): ScanBuffer {
  return {
    baseY,
    getLine: (y: number) => {
      const text = lines[y - baseY]
      return text === undefined ? undefined : { translateToString: () => text }
    }
  }
}

describe('readBufferText', () => {
  it('reads `rows` lines from baseY and joins them with newlines', () => {
    expect(readBufferText(fakeBuffer(['a', 'b', 'c']), 3)).toBe('a\nb\nc')
  })
  it('starts at baseY, not 0, for a scrolled buffer', () => {
    expect(readBufferText(fakeBuffer(['x', 'y'], 100), 2)).toBe('x\ny')
  })
  it('treats a missing line as empty rather than throwing', () => {
    expect(readBufferText(fakeBuffer(['only']), 3)).toBe('only\n\n')
  })
})

describe('normalizeForStability', () => {
  // The exact two frames captured 2026-07-29: the tool bullet ⏺ blinks to a space.
  const ON = '⏺ Listing 1 directory…'
  const OFF = '  Listing 1 directory…'

  it('collapses the blinking ⏺ bullet so the two blink frames compare equal', () => {
    expect(normalizeForStability(ON)).toBe(normalizeForStability(OFF))
  })

  it('leaves the approval menu (❯ 1. Yes) intact for scanning', () => {
    expect(normalizeForStability(' ❯ 1. Yes\n   2. No')).toContain('❯ 1. Yes')
  })

  it('does not touch ordinary text', () => {
    expect(normalizeForStability('building project...')).toBe('building project...')
  })
})

// stepIdle is the buffer-stability decision. It must treat a repaint that renders
// the SAME text as "unchanged" (so a ~600ms cursor-blink stream still settles),
// and only settle once the text has held still for the quiet window.
describe('stepIdle', () => {
  const Q = 700

  it('a content change while settled reports active and resets to active phase', () => {
    let s = { lastText: 'old', lastChangeTs: 0, phase: 'settled' as const }
    const r = stepIdle(s, 'new', 1000, Q)
    expect(r.emit).toBe('active')
    expect(r.state).toEqual({ lastText: 'new', lastChangeTs: 1000, phase: 'active' })
  })

  it('a content change while already active does not re-report active', () => {
    let s = { lastText: 'a', lastChangeTs: 0, phase: 'active' as const }
    const r = stepIdle(s, 'b', 500, Q)
    expect(r.emit).toBeNull()
    expect(r.state.lastChangeTs).toBe(500) // timer reset by the change
  })

  it('an unchanged repaint before the quiet window does NOT settle', () => {
    let s = { lastText: 'same', lastChangeTs: 0, phase: 'active' as const }
    const r = stepIdle(s, 'same', 600, Q) // only 600ms of stability
    expect(r.emit).toBeNull()
    expect(r.state.phase).toBe('active')
  })

  it('unchanged for the full quiet window → settled, reported once', () => {
    let s = { lastText: 'same', lastChangeTs: 0, phase: 'active' as const }
    const r1 = stepIdle(s, 'same', 700, Q)
    expect(r1.emit).toBe('settled')
    expect(r1.state.phase).toBe('settled')
    // already settled → no repeat on the next unchanged poll
    const r2 = stepIdle(r1.state, 'same', 1200, Q)
    expect(r2.emit).toBeNull()
  })

  it('the cursor-blink case: identical repaints across time still settle', () => {
    // Simulate polls at 350ms with byte-identical buffer text (the confirmed
    // real behaviour of the blinking-dot prompt).
    let s = initialIdleState(0)
    s = stepIdle(s, 'PROMPT', 350, Q).state // first content → active phase, timer at 350
    const a = stepIdle(s, 'PROMPT', 700, Q) // 350ms stable
    expect(a.emit).toBeNull()
    const b = stepIdle(a.state, 'PROMPT', 1050, Q) // 700ms stable
    expect(b.emit).toBe('settled')
  })

  it('initialIdleState starts active with the mount time as the change mark', () => {
    expect(initialIdleState(42)).toEqual({ lastText: '', lastChangeTs: 42, phase: 'active' })
  })
})
