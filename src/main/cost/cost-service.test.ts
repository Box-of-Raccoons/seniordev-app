import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { costForConversation, usageForConversation } from './cost-service'
import { DEFAULT_RATES } from './pricing'

// Real files in a temp tree rather than a mocked fs: the thing under test is
// "can it find and read the transcript", which a mock would assume away.
let root: string
let claudeDir: string
let codexDir: string

const CLAUDE_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const CODEX_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'

function claudeLine(model: string, usage: Record<string, unknown>, sidechain = false): string {
  return JSON.stringify({ type: 'assistant', isSidechain: sidechain, message: { model, usage } })
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'seniordev-cost-'))
  claudeDir = join(root, 'projects')
  codexDir = join(root, 'codex')
  // claude nests transcripts one project dir deep; the service scans for the id.
  mkdirSync(join(claudeDir, '-some-project'), { recursive: true })
  writeFileSync(
    join(claudeDir, '-some-project', `${CLAUDE_ID}.jsonl`),
    [
      claudeLine('claude-opus-5', { input_tokens: 1_000_000, output_tokens: 0 }),
      claudeLine('claude-haiku-4-5', { input_tokens: 1_000_000, output_tokens: 0 }, true)
    ].join('\n')
  )
  // codex nests by date; the service walks recursively matching the id.
  mkdirSync(join(codexDir, '2026', '08'), { recursive: true })
  writeFileSync(
    join(codexDir, '2026', '08', `rollout-2026-08-01-${CODEX_ID}.jsonl`),
    JSON.stringify({ total_token_usage: { input_tokens: 500, output_tokens: 100 } })
  )
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

const deps = (): { claudeProjectsDir: string; codexSessionsDir: string } => ({
  claudeProjectsDir: claudeDir,
  codexSessionsDir: codexDir
})

describe('usageForConversation', () => {
  it('finds a claude transcript nested in a project dir', () => {
    const u = usageForConversation({ tool: 'claude', agentSessionId: CLAUDE_ID }, deps())
    expect(u.assistantMessages).toBe(2)
  })

  it('finds a codex rollout nested by date', () => {
    const u = usageForConversation({ tool: 'codex', agentSessionId: CODEX_ID }, deps())
    expect(u.main[0].tally.inputTokens).toBe(500)
  })

  it('reports nothing for a conversation with no session id', () => {
    expect(usageForConversation({ tool: 'claude', agentSessionId: null }, deps()).assistantMessages).toBe(0)
  })

  it('reports nothing when the transcript is missing', () => {
    expect(usageForConversation({ tool: 'claude', agentSessionId: 'no-such-id' }, deps()).assistantMessages).toBe(0)
  })

  it('reports nothing for a tool whose format we do not know, rather than guessing', () => {
    expect(usageForConversation({ tool: 'some-other-agent', agentSessionId: CLAUDE_ID }, deps()).assistantMessages).toBe(0)
  })

  it('degrades to nothing when the directory does not exist', () => {
    const u = usageForConversation(
      { tool: 'claude', agentSessionId: CLAUDE_ID },
      { claudeProjectsDir: join(root, 'nope'), codexSessionsDir: codexDir }
    )
    expect(u.assistantMessages).toBe(0)
  })
})

describe('costForConversation', () => {
  it('prices the main session', () => {
    const c = costForConversation({ id: 'c1', tool: 'claude', agentSessionId: CLAUDE_ID }, deps())
    // 1M input on Opus 5 at $5/MTok.
    expect(c.main.cost).toBeCloseTo(5, 6)
    expect(c.main.tokens).toBe(1_000_000)
  })

  it('SEPARATES subagent spend from the main session', () => {
    const c = costForConversation({ id: 'c1', tool: 'claude', agentSessionId: CLAUDE_ID }, deps())
    // The sidechain ran haiku at $1/MTok, so it must not be folded into the $5.
    expect(c.sidechain.cost).toBeCloseTo(1, 6)
    expect(c.sidechain.tokens).toBe(1_000_000)
  })

  it('lists every model the session used', () => {
    const c = costForConversation({ id: 'c1', tool: 'claude', agentSessionId: CLAUDE_ID }, deps())
    expect(c.models.sort()).toEqual(['claude-haiku-4-5', 'claude-opus-5'])
  })

  it('returns a NULL cost, not a partial sum, when a model has no known rate', () => {
    // A cost that silently omits a model reads as complete and is not.
    const dir = join(root, 'unpriced')
    mkdirSync(join(dir, 'p'), { recursive: true })
    const id = 'cccccccc-3333-4333-8333-cccccccccccc'
    writeFileSync(
      join(dir, 'p', `${id}.jsonl`),
      [
        claudeLine('claude-opus-5', { output_tokens: 1000 }),
        claudeLine('brand-new-model', { output_tokens: 1000 })
      ].join('\n')
    )
    const c = costForConversation(
      { id: 'c2', tool: 'claude', agentSessionId: id },
      { claudeProjectsDir: dir, codexSessionsDir: codexDir }
    )
    expect(c.main.cost).toBeNull()
    expect(c.main.unpricedModels).toContain('brand-new-model')
    // Tokens are still counted — they are never in doubt, only their price is.
    expect(c.main.tokens).toBe(2000)
  })

  it('honours a config rate override', () => {
    const c = costForConversation(
      { id: 'c1', tool: 'claude', agentSessionId: CLAUDE_ID },
      { ...deps(), rates: { ...DEFAULT_RATES, 'claude-opus-5': { input: 50, output: 250 } } }
    )
    expect(c.main.cost).toBeCloseTo(50, 6)
  })

  it('reports zero, not null, for a session that used nothing', () => {
    const c = costForConversation({ id: 'c3', tool: 'claude', agentSessionId: null }, deps())
    expect(c.main.cost).toBe(0)
    expect(c.main.tokens).toBe(0)
    expect(c.models).toEqual([])
  })

  it('carries the conversation id through', () => {
    expect(costForConversation({ id: 'c9', tool: 'claude', agentSessionId: CLAUDE_ID }, deps()).conversationId).toBe('c9')
  })
})
