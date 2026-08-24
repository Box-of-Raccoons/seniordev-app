import { describe, it, expect } from 'vitest'
import { parseClaudeUsage, parseCodexUsage, totalTally } from './transcript-usage'

// Shaped from real files on disk: an assistant record carries message.usage,
// message.model, and a top-level isSidechain.
// Each call gets a distinct message id by default, because a repeated id means
// "the same API response, split across content blocks" — see the dedup tests.
let nextId = 0
function claudeLine(over: Record<string, unknown> = {}, usage: Record<string, unknown> = {}): string {
  const base = {
    type: 'assistant',
    isSidechain: false,
    message: {
      id: `msg_${++nextId}`,
      model: 'claude-opus-5',
      usage: {
        input_tokens: 2,
        output_tokens: 477,
        cache_read_input_tokens: 134934,
        cache_creation_input_tokens: 1205,
        cache_creation: { ephemeral_1h_input_tokens: 1205, ephemeral_5m_input_tokens: 0 },
        ...usage
      }
    }
  }
  // A caller overriding `message` replaces it wholesale; keep an id unless one
  // was given explicitly.
  const merged = { ...base, ...over } as { message: Record<string, unknown> }
  if (over.message && !(over.message as Record<string, unknown>).id) {
    merged.message = { id: `msg_${++nextId}`, ...(over.message as Record<string, unknown>) }
  }
  return JSON.stringify(merged)
}

// The real shape of a multi-block response: N lines, ONE message id, the SAME
// complete usage object repeated on every line.
function claudeBlocks(count: number, usage: Record<string, unknown> = {}): string {
  const id = `msg_shared_${++nextId}`
  return Array.from({ length: count }, () =>
    JSON.stringify({
      type: 'assistant',
      isSidechain: false,
      message: {
        id,
        model: 'claude-opus-5',
        usage: { input_tokens: 2, output_tokens: 477, ...usage }
      }
    })
  ).join('\n')
}

describe('parseClaudeUsage', () => {
  it('returns nothing for empty input', () => {
    expect(parseClaudeUsage('')).toEqual({ main: [], sidechain: [], assistantMessages: 0 })
  })

  it('reads one assistant message', () => {
    const u = parseClaudeUsage(claudeLine())
    expect(u.assistantMessages).toBe(1)
    expect(u.main).toHaveLength(1)
    expect(u.main[0].model).toBe('claude-opus-5')
    expect(u.main[0].tally).toEqual({
      inputTokens: 2,
      outputTokens: 477,
      cacheReadTokens: 134934,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 1205
    })
  })

  it('keeps the two cache-write tiers apart, since they are priced differently', () => {
    const u = parseClaudeUsage(
      claudeLine({}, {
        cache_creation_input_tokens: 300,
        cache_creation: { ephemeral_1h_input_tokens: 100, ephemeral_5m_input_tokens: 200 }
      })
    )
    expect(u.main[0].tally.cacheWrite1hTokens).toBe(100)
    expect(u.main[0].tally.cacheWrite5mTokens).toBe(200)
  })

  it('derives the 5m tier from the total when only the 1h figure is present', () => {
    // The untested branch: total minus the 1h part is what remains for 5m.
    const u = parseClaudeUsage(
      claudeLine({}, {
        cache_creation_input_tokens: 300,
        cache_creation: { ephemeral_1h_input_tokens: 100 }
      })
    )
    expect(u.main[0].tally.cacheWrite1hTokens).toBe(100)
    expect(u.main[0].tally.cacheWrite5mTokens).toBe(200)
  })

  it('never derives a NEGATIVE 5m figure if the total is smaller than the 1h part', () => {
    const u = parseClaudeUsage(
      claudeLine({}, {
        cache_creation_input_tokens: 50,
        cache_creation: { ephemeral_1h_input_tokens: 100 }
      })
    )
    expect(u.main[0].tally.cacheWrite5mTokens).toBe(0)
  })

  it('falls back to the total when no split is present, attributing it to the CHEAPER tier', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        model: 'claude-opus-5',
        usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 500 }
      }
    })
    const t = parseClaudeUsage(line).main[0].tally
    // 5m is the default TTL and the cheaper rate, so an unknown split never overstates.
    expect(t.cacheWrite5mTokens).toBe(500)
    expect(t.cacheWrite1hTokens).toBe(0)
  })

  it('sums DISTINCT messages on the same model', () => {
    const u = parseClaudeUsage([claudeLine(), claudeLine()].join('\n'))
    expect(u.assistantMessages).toBe(2)
    expect(u.main).toHaveLength(1)
    expect(u.main[0].tally.outputTokens).toBe(954)
  })

  // THE REGRESSION. claude writes one line PER CONTENT BLOCK of the same API
  // message, each repeating the identical usage object. Summing the lines
  // counted a single response two to three times over: measured 2.08x on a real
  // transcript (614 usage-bearing lines, 358 distinct message ids). The old
  // fixture gave every line a fresh implicit identity, so it never saw this.
  it('counts a multi-block response ONCE, not once per block', () => {
    const u = parseClaudeUsage(claudeBlocks(4))
    expect(u.assistantMessages).toBe(1)
    expect(u.main[0].tally.outputTokens).toBe(477)
  })

  it('deduplicates across interleaved messages, not just adjacent lines', () => {
    const a = claudeBlocks(3, { output_tokens: 100 })
    const b = claudeBlocks(2, { output_tokens: 50 })
    const u = parseClaudeUsage([a, b].join('\n'))
    expect(u.assistantMessages).toBe(2)
    expect(u.main[0].tally.outputTokens).toBe(150)
  })

  it('falls back to requestId when a record carries no message id', () => {
    const line = (rid: string): string =>
      JSON.stringify({ type: 'assistant', requestId: rid, message: { model: 'claude-opus-5', usage: { output_tokens: 10 } } })
    const u = parseClaudeUsage([line('req_1'), line('req_1'), line('req_2')].join('\n'))
    expect(u.assistantMessages).toBe(2)
    expect(u.main[0].tally.outputTokens).toBe(20)
  })

  it('still counts a record with NEITHER id, since dropping it would understate', () => {
    const line = JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5', usage: { output_tokens: 7 } } })
    const u = parseClaudeUsage([line, line].join('\n'))
    expect(u.assistantMessages).toBe(2)
    expect(u.main[0].tally.outputTokens).toBe(14)
  })

  it('keeps models SEPARATE, because a session that switches models must be priced per message', () => {
    const u = parseClaudeUsage(
      [claudeLine(), claudeLine({ message: { model: 'claude-haiku-4-5', usage: { output_tokens: 10 } } })].join('\n')
    )
    expect(u.main.map((m) => m.model).sort()).toEqual(['claude-haiku-4-5', 'claude-opus-5'])
  })

  it('separates subagent spend from the main session via isSidechain', () => {
    const u = parseClaudeUsage([claudeLine(), claudeLine({ isSidechain: true })].join('\n'))
    expect(u.main).toHaveLength(1)
    expect(u.sidechain).toHaveLength(1)
    expect(u.sidechain[0].tally.outputTokens).toBe(477)
  })

  it('ignores user records and records with no usage', () => {
    const u = parseClaudeUsage(
      [
        JSON.stringify({ type: 'user', message: { content: 'hi' } }),
        JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5' } }),
        claudeLine()
      ].join('\n')
    )
    expect(u.assistantMessages).toBe(1)
  })

  it('skips malformed lines rather than throwing', () => {
    const u = parseClaudeUsage(['not json at all', claudeLine(), '{"broken":'].join('\n'))
    expect(u.assistantMessages).toBe(1)
  })

  it('treats a missing model as empty rather than dropping the tokens', () => {
    const line = JSON.stringify({ type: 'assistant', message: { usage: { output_tokens: 9 } } })
    const u = parseClaudeUsage(line)
    expect(u.main[0].model).toBe('')
    expect(u.main[0].tally.outputTokens).toBe(9)
  })

  it('ignores non-numeric usage values instead of producing NaN', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { model: 'claude-opus-5', usage: { output_tokens: 'lots', input_tokens: 5 } }
    })
    const t = parseClaudeUsage(line).main[0].tally
    expect(t.outputTokens).toBe(0)
    expect(t.inputTokens).toBe(5)
  })
})

describe('parseCodexUsage', () => {
  // THE REAL SHAPE, taken from a rollout on disk: the usage sits at
  // payload.info.total_token_usage on a token_count event. The original tests
  // asserted payload.total_token_usage, which appears in ZERO real rollouts —
  // so they passed while the parser found nothing in every actual file and
  // every codex session silently reported $0.
  const usageLine = (over: Record<string, unknown>): string =>
    JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 0,
            cached_input_tokens: 0,
            cache_write_input_tokens: 0,
            output_tokens: 0,
            reasoning_output_tokens: 0,
            total_tokens: 0,
            ...over
          }
        }
      }
    })

  it('returns nothing for empty input', () => {
    expect(parseCodexUsage('')).toEqual({ main: [], sidechain: [], assistantMessages: 0 })
  })

  it('TAKES THE LAST cumulative total rather than summing', () => {
    // codex restates a running total on every record; summing would multiply
    // the real cost by the number of turns.
    const u = parseCodexUsage(
      [usageLine({ input_tokens: 100 }), usageLine({ input_tokens: 500 }), usageLine({ input_tokens: 900 })].join('\n')
    )
    expect(u.main[0].tally.inputTokens).toBe(900)
  })

  it('does NOT add reasoning tokens, because output_tokens already includes them', () => {
    // Verified by arithmetic on a real rollout: input 84905 + output 534 equals
    // total_tokens 85439 exactly, so reasoning is inside output already. Adding
    // it counted those tokens twice.
    const u = parseCodexUsage(usageLine({ output_tokens: 534, reasoning_output_tokens: 64, total_tokens: 534 }))
    expect(u.main[0].tally.outputTokens).toBe(534)
  })

  it('treats cached input as a SUBSET of input, not a sibling', () => {
    // cached_input_tokens (80896) <= input_tokens (84905) in real data. Counting
    // both in full priced the cached portion at the full input rate AND again
    // at the cache rate.
    const u = parseCodexUsage(usageLine({ input_tokens: 84905, cached_input_tokens: 80896 }))
    expect(u.main[0].tally.inputTokens).toBe(4009)
    expect(u.main[0].tally.cacheReadTokens).toBe(80896)
  })

  it('never reports negative fresh input if cached somehow exceeds input', () => {
    const u = parseCodexUsage(usageLine({ input_tokens: 10, cached_input_tokens: 99 }))
    expect(u.main[0].tally.inputTokens).toBe(0)
  })

  it('maps cache-write tokens', () => {
    const u = parseCodexUsage(usageLine({ cache_write_input_tokens: 12 }))
    expect(u.main[0].tally.cacheWrite5mTokens).toBe(12)
  })

  it('still reads a top-level total_token_usage, as a tolerant fallback', () => {
    const u = parseCodexUsage(JSON.stringify({ total_token_usage: { input_tokens: 5 } }))
    expect(u.main[0].tally.inputTokens).toBe(5)
  })

  it('never reports a sidechain, because codex has no subagents', () => {
    expect(parseCodexUsage(usageLine({ input_tokens: 1 })).sidechain).toEqual([])
  })

  it('picks up the model from a turn_context payload', () => {
    const u = parseCodexUsage(
      [JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5' } }), usageLine({ input_tokens: 3 })].join('\n')
    )
    expect(u.main[0].model).toBe('gpt-5')
  })

  it('reads usage nested inside a payload as well as at the top level', () => {
    const u = parseCodexUsage(
      JSON.stringify({ type: 'event_msg', payload: { total_token_usage: { input_tokens: 42 } } })
    )
    expect(u.main[0].tally.inputTokens).toBe(42)
  })

  it('skips malformed lines', () => {
    expect(parseCodexUsage(['garbage', usageLine({ input_tokens: 7 })].join('\n')).main[0].tally.inputTokens).toBe(7)
  })
})

describe('totalTally', () => {
  it('sums across models', () => {
    const u = parseClaudeUsage(
      [claudeLine(), claudeLine({ message: { model: 'claude-haiku-4-5', usage: { output_tokens: 23 } } })].join('\n')
    )
    expect(totalTally(u.main).outputTokens).toBe(500)
  })

  it('is zero for nothing', () => {
    expect(totalTally([]).outputTokens).toBe(0)
  })
})
