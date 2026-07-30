import { describe, it, expect } from 'vitest'
import { shouldAutoClose } from './auto-close'

describe('shouldAutoClose (spec 7.2 / D3)', () => {
  it('closes a cleanly-exited agent terminal tab', () => {
    expect(shouldAutoClose('terminal', 0)).toBe(true)
  })
  it('closes a cleanly-exited shell tab (Hardy D3)', () => {
    expect(shouldAutoClose('shell', 0)).toBe(true)
  })
  it('keeps a YOLO tab on a clean exit (needsReview)', () => {
    expect(shouldAutoClose('yolo', 0)).toBe(false)
  })
  it('keeps any tab that exited non-zero (failed, visible)', () => {
    expect(shouldAutoClose('terminal', 1)).toBe(false)
    expect(shouldAutoClose('shell', 130)).toBe(false)
    expect(shouldAutoClose('yolo', 2)).toBe(false)
  })
  it('never applies to a composer (no pty)', () => {
    expect(shouldAutoClose('composer', 0)).toBe(false)
  })
})
