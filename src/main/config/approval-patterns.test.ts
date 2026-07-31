import { describe, it, expect } from 'vitest'
import { CLI_PRESETS } from './presets'
import { CliToolSchema } from './schema'

// Apply a tool's approvalPatterns the same way the renderer matcher does — any
// pattern matching (case-insensitive) means "prompt". Kept local so this main
// test needs no renderer import; the matcher's own behaviour is covered by
// status-matcher.test.ts.
function looksLikePrompt(patterns: readonly string[], text: string): boolean {
  return patterns.some((p) => new RegExp(p, 'i').test(text))
}

// Text CAPTURED from real rendered xterm buffers on 2026-07-29
// (~/.config/SeniorDev/status-scan-debug.txt). These pin the SHIPPED presets to
// prompts they must actually match — the point of authoring from capture, not
// reasoning (plan section 5).
const CLAUDE_PROMPT = ' Do you want to proceed?\n ❯ 1. Yes\n   2. No\n\n Esc to cancel · Tab to amend · ctrl+e to explain'
const CODEX_PROMPT = '  Would you like to run the following command?\n\n  $ open -a "Google Chrome"\n› 1. Yes, proceed (y)\n\n  Press enter to confirm or esc to cancel'
const IDLE_SHELL = 'unknown1a22c802d291:code hardyspry$ '

describe('CLI_PRESETS approvalPatterns match the captured prompts', () => {
  it('claude presets fire on the captured claude permission prompt', () => {
    expect(looksLikePrompt(CLI_PRESETS.claude.approvalPatterns, CLAUDE_PROMPT)).toBe(true)
  })
  it('codex presets fire on the captured codex approval prompt', () => {
    expect(looksLikePrompt(CLI_PRESETS.codex.approvalPatterns, CODEX_PROMPT)).toBe(true)
  })
  it('neither tool fires on an idle shell (no false positive)', () => {
    expect(looksLikePrompt(CLI_PRESETS.claude.approvalPatterns, IDLE_SHELL)).toBe(false)
    expect(looksLikePrompt(CLI_PRESETS.codex.approvalPatterns, IDLE_SHELL)).toBe(false)
  })
})

describe('CliToolSchema approvalPatterns — graceful absence', () => {
  it('an absent approvalPatterns key parses to [] rather than throwing', () => {
    const parsed = CliToolSchema.parse({ command: 'somecli' })
    expect(parsed.approvalPatterns).toEqual([])
  })

  it('[] means no prompt detection — matches nothing', () => {
    const parsed = CliToolSchema.parse({ command: 'somecli' })
    expect(looksLikePrompt(parsed.approvalPatterns, CLAUDE_PROMPT)).toBe(false)
  })

  it('a configured approvalPatterns array is preserved', () => {
    const parsed = CliToolSchema.parse({ command: 'x', approvalPatterns: ['Proceed\\?'] })
    expect(parsed.approvalPatterns).toEqual(['Proceed\\?'])
  })
})
