import { describe, it, expect } from 'vitest'
import { matchesPrompt, readBufferText, type ScanBuffer } from './status-matcher'

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
    const buf = fakeBuffer(['line one', 'line two', 'line three'])
    expect(readBufferText(buf, 3)).toBe('line one\nline two\nline three')
  })

  it('starts at baseY, not 0, for a scrolled buffer', () => {
    const buf = fakeBuffer(['visible a', 'visible b'], 100)
    expect(readBufferText(buf, 2)).toBe('visible a\nvisible b')
  })

  it('treats a missing line as empty rather than throwing', () => {
    const buf = fakeBuffer(['only line'])
    expect(readBufferText(buf, 3)).toBe('only line\n\n')
  })
})

// These test the matcher MECHANISM with synthetic patterns. The real default
// approvalPatterns are authored from CAPTURED rendered buffers (plan section 5);
// the captured-text tests are added once those samples exist (step 4 completion).
describe('matchesPrompt (mechanism)', () => {
  it('no patterns → never matches (the graceful default)', () => {
    expect(matchesPrompt('Do you want to proceed?', [])).toBe(false)
  })

  it('matches when a pattern regex hits the buffer text', () => {
    expect(matchesPrompt('  ❯ 1. Yes\n  2. No', ['❯\\s*1\\.\\s*Yes'])).toBe(true)
  })

  it('does not match when no pattern hits', () => {
    expect(matchesPrompt('building project...\ncompiled ok', ['Do you want to proceed'])).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(matchesPrompt('ALLOW THIS ACTION?', ['allow this action'])).toBe(true)
  })

  it('skips a malformed regex and still tries the others', () => {
    // '(' is an invalid regex source; it must be skipped, not thrown, and the
    // valid pattern after it must still match.
    expect(matchesPrompt('proceed? (y/n)', ['(', 'proceed\\?'])).toBe(true)
  })

  it('ignores empty pattern strings', () => {
    expect(matchesPrompt('anything', ['', ''])).toBe(false)
  })

  it('matches if ANY of several patterns hits', () => {
    expect(matchesPrompt('waiting for approval', ['no-match-a', 'approval', 'no-match-b'])).toBe(true)
  })
})
