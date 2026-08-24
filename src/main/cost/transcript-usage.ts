import { addTally, emptyTally, type TokenTally } from './pricing'

// Pure parsers over agent transcripts (supervision slice 3a). The app already
// reads these files for titles (session-title.ts); this reads their token usage.
// Total over malformed input: a line that does not parse is skipped, never thrown.

export interface ModelTally {
  model: string
  tally: TokenTally
}

export interface TranscriptUsage {
  // Per model, because a session that switches models must be priced per
  // message or the number is wrong.
  main: ModelTally[]
  // claude marks subagent turns with isSidechain. Splitting them out is the
  // actionable number for an orchestrator workflow: knowing the fan-out cost
  // four times the orchestration is what you act on.
  sidechain: ModelTally[]
  assistantMessages: number
}

export function emptyUsage(): TranscriptUsage {
  return { main: [], sidechain: [], assistantMessages: 0 }
}

function accumulate(into: ModelTally[], model: string, tally: TokenTally): void {
  const existing = into.find((m) => m.model === model)
  if (existing) existing.tally = addTally(existing.tally, tally)
  else into.push({ model, tally })
}

// One claude `usage` object to a tally. `cache_creation_input_tokens` is the
// TOTAL of both TTL tiers and `cache_creation` carries the split; the tiers are
// priced differently, so prefer the split and only fall back to the total.
// A total with no split is attributed to the 5-minute tier, which is the
// default TTL — the cheaper of the two, so an unknown split never overstates.
function claudeTally(usage: Record<string, unknown>): TokenTally {
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const split = usage.cache_creation as Record<string, unknown> | undefined
  const has1h = split && typeof split.ephemeral_1h_input_tokens === 'number'
  const has5m = split && typeof split.ephemeral_5m_input_tokens === 'number'

  const write1h = has1h ? num(split!.ephemeral_1h_input_tokens) : 0
  const write5m = has5m
    ? num(split!.ephemeral_5m_input_tokens)
    : has1h
      ? Math.max(0, num(usage.cache_creation_input_tokens) - write1h)
      : num(usage.cache_creation_input_tokens)

  return {
    inputTokens: num(usage.input_tokens),
    outputTokens: num(usage.output_tokens),
    cacheReadTokens: num(usage.cache_read_input_tokens),
    cacheWrite5mTokens: write5m,
    cacheWrite1hTokens: write1h
  }
}

export function parseClaudeUsage(content: string): TranscriptUsage {
  const out = emptyUsage()
  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    let o: {
      type?: string
      isSidechain?: boolean
      message?: { model?: string; usage?: Record<string, unknown> }
    }
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    if (o?.type !== 'assistant') continue
    const usage = o.message?.usage
    if (!usage) continue
    out.assistantMessages++
    const model = typeof o.message?.model === 'string' ? o.message.model : ''
    accumulate(o.isSidechain ? out.sidechain : out.main, model, claudeTally(usage))
  }
  return out
}

// A codex rollout reports `total_token_usage` CUMULATIVELY — every record
// restates the running total. Summing them would multiply the real cost by the
// number of turns, so the LAST record wins rather than being added.
export function parseCodexUsage(content: string): TranscriptUsage {
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  let latest: Record<string, unknown> | null = null
  let model = ''
  let turns = 0

  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    let o: Record<string, unknown>
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    // The usage and the model can each sit at the top level or inside a payload.
    const payload = (o.payload as Record<string, unknown> | undefined) ?? o
    const usage = (payload.total_token_usage ?? o.total_token_usage) as
      | Record<string, unknown>
      | undefined
    if (usage) {
      latest = usage
      turns++
    }
    const m = (payload.model ?? o.model) as unknown
    if (typeof m === 'string' && m) model = m
  }

  if (!latest) return emptyUsage()
  return {
    main: [
      {
        model,
        tally: {
          inputTokens: num(latest.input_tokens),
          // Reasoning tokens are billed as output; dropping them would
          // understate a thinking-heavy session.
          outputTokens: num(latest.output_tokens) + num(latest.reasoning_output_tokens),
          cacheReadTokens: num(latest.cached_input_tokens),
          cacheWrite5mTokens: num(latest.cache_write_input_tokens),
          cacheWrite1hTokens: 0
        }
      }
    ],
    // codex has no subagents, so there is never a sidechain to separate.
    sidechain: [],
    assistantMessages: turns
  }
}

export function totalTally(entries: ModelTally[]): TokenTally {
  return entries.reduce((acc, e) => addTally(acc, e.tally), emptyTally())
}
