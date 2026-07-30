import { describe, it, expect } from 'vitest'
import { matchesPrompt } from './prompt-match'

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
    expect(matchesPrompt('proceed? (y/n)', ['(', 'proceed\\?'])).toBe(true)
  })
  it('ignores empty pattern strings', () => {
    expect(matchesPrompt('anything', ['', ''])).toBe(false)
  })
  it('matches if ANY of several patterns hits', () => {
    expect(matchesPrompt('waiting for approval', ['no-match-a', 'approval', 'no-match-b'])).toBe(true)
  })
})

// Run against text CAPTURED from real rendered xterm buffers (2026-07-29), not
// invented text. The shipped pattern (see CLI_PRESETS) is the tool-agnostic
// selection menu: cursor glyph, numbered option, word. Validated here to fire on
// both tools' prompts and not on ordinary output.
const SELECTOR = ['[❯›]\\s+\\d+\\.\\s+\\w']

const CLAUDE_PROMPT = [
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. No',
  '',
  ' Esc to cancel · Tab to amend · ctrl+e to explain'
].join('\n')

const CODEX_PROMPT = [
  '  Would you like to run the following command?',
  '',
  '  $ open -a "Google Chrome"',
  '› 1. Yes, proceed (y)',
  '',
  '  Press enter to confirm or esc to cancel'
].join('\n')

const IDLE_SHELL = 'unknown1a22c802d291:code hardyspry$ '
const CODEX_WORKING = '• I’ll list the /home directory entries.'

describe('matchesPrompt against captured buffers', () => {
  it('detects the claude permission prompt (❯ selector)', () => {
    expect(matchesPrompt(CLAUDE_PROMPT, SELECTOR)).toBe(true)
  })
  it('detects the codex command-approval prompt (› selector)', () => {
    expect(matchesPrompt(CODEX_PROMPT, SELECTOR)).toBe(true)
  })
  it('does not fire on an idle shell or ordinary agent output', () => {
    expect(matchesPrompt(IDLE_SHELL, SELECTOR)).toBe(false)
    expect(matchesPrompt(CODEX_WORKING, SELECTOR)).toBe(false)
  })
})
