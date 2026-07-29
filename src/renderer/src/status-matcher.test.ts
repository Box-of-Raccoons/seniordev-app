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

// The gate for step 4: the matcher run against text CAPTURED from real rendered
// xterm buffers (2026-07-29, ~/.config/SeniorDev/status-scan-debug.txt), not
// invented text. Patterns here mirror the shipped CLI_PRESETS; a separate
// main-side test pins the presets themselves to these same captures.
const CLAUDE_PATTERNS = ['Do you want to proceed\\?', 'Esc to cancel.*Tab to amend']
const CODEX_PATTERNS = ['Would you like to run the following command\\?', 'Press enter to confirm or esc to cancel']

// A real claude 2.1.212 bash-permission prompt.
const CLAUDE_PROMPT = [
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. No',
  '',
  ' Esc to cancel · Tab to amend · ctrl+e to explain'
].join('\n')

// A real codex-cli 0.146.0 command-approval prompt.
const CODEX_PROMPT = [
  '  Would you like to run the following command?',
  '',
  '  $ open -a "Google Chrome"',
  '› 1. Yes, proceed (y)',
  '',
  '  Press enter to confirm or esc to cancel'
].join('\n')

// A captured NON-prompt buffer: an idle shell, plus a line of ordinary codex
// working output. Neither should read as an approval prompt.
const IDLE_SHELL = 'unknown1a22c802d291:code hardyspry$ '
const CODEX_WORKING = '• I’ll list the /home directory entries.'

describe('matchesPrompt against captured buffers', () => {
  it('detects the claude permission prompt', () => {
    expect(matchesPrompt(CLAUDE_PROMPT, CLAUDE_PATTERNS)).toBe(true)
  })
  it('detects the codex command-approval prompt', () => {
    expect(matchesPrompt(CODEX_PROMPT, CODEX_PATTERNS)).toBe(true)
  })
  it('does not fire on an idle shell or on ordinary agent output', () => {
    const allPatterns = [...CLAUDE_PATTERNS, ...CODEX_PATTERNS] // shell tabs scan the union (plan section 3)
    expect(matchesPrompt(IDLE_SHELL, allPatterns)).toBe(false)
    expect(matchesPrompt(CODEX_WORKING, allPatterns)).toBe(false)
  })
  it('does not cross-match: claude patterns miss the codex prompt and vice versa', () => {
    expect(matchesPrompt(CODEX_PROMPT, CLAUDE_PATTERNS)).toBe(false)
    expect(matchesPrompt(CLAUDE_PROMPT, CODEX_PATTERNS)).toBe(false)
  })
})
