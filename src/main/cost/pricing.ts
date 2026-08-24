// Pure token pricing (supervision slice 3a). No IO, no model calls — given a
// token tally and a model name, produce a notional cost.
//
// "Notional" is load-bearing: work here runs on a Max subscription, so this is
// the API-equivalent price of the same tokens. It is useful for comparing two
// sessions against each other and meaningless as a bill. The UI must say so.

export interface ModelRate {
  // US dollars per million tokens.
  input: number
  output: number
}

// Cache tokens are priced as multiples of the model's INPUT rate rather than
// carried as separate columns, because that is how the pricing actually works
// and it keeps a new model to two numbers.
export const CACHE_READ_MULTIPLIER = 0.1
// The two write tiers genuinely differ, and collapsing them would quietly
// misprice any session that used the 1h cache.
export const CACHE_WRITE_5M_MULTIPLIER = 1.25
export const CACHE_WRITE_1H_MULTIPLIER = 2.0

// Bundled defaults, in USD per million tokens. These change, so config can
// override any entry and add models this table has never heard of; an unpriced
// model yields null rather than a guess.
export const DEFAULT_RATES: Readonly<Record<string, ModelRate>> = Object.freeze({
  'claude-fable-5': { input: 10, output: 50 },
  'claude-mythos-5': { input: 10, output: 50 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 }
})

export interface TokenTally {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWrite5mTokens: number
  cacheWrite1hTokens: number
}

export function emptyTally(): TokenTally {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0
  }
}

export function addTally(a: TokenTally, b: TokenTally): TokenTally {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWrite5mTokens: a.cacheWrite5mTokens + b.cacheWrite5mTokens,
    cacheWrite1hTokens: a.cacheWrite1hTokens + b.cacheWrite1hTokens
  }
}

export function totalTokens(t: TokenTally): number {
  return (
    t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWrite5mTokens + t.cacheWrite1hTokens
  )
}

// Match a transcript's model string to a rate. Transcripts sometimes carry a
// dated snapshot id (claude-haiku-4-5-20251001) where the rate table has the
// bare alias, so an exact miss falls back to the longest table key the model
// starts with. Longest-first matters: `claude-opus-4-8` must not lose to a
// shorter prefix that happens to also match.
export function rateFor(model: string, rates: Record<string, ModelRate>): ModelRate | null {
  if (!model) return null
  const exact = rates[model]
  if (exact) return exact
  let best: { key: string; rate: ModelRate } | null = null
  for (const [key, rate] of Object.entries(rates)) {
    if (!model.startsWith(key)) continue
    if (!best || key.length > best.key.length) best = { key, rate }
  }
  return best?.rate ?? null
}

// Notional USD for one model's tokens, or null when the model has no known
// rate. Null is deliberate: a confidently wrong cost is worse than none.
export function costFor(
  tally: TokenTally,
  model: string,
  rates: Record<string, ModelRate> = DEFAULT_RATES
): number | null {
  const rate = rateFor(model, rates)
  if (!rate) return null
  const perInputToken = rate.input / 1_000_000
  const perOutputToken = rate.output / 1_000_000
  return (
    tally.inputTokens * perInputToken +
    tally.outputTokens * perOutputToken +
    tally.cacheReadTokens * perInputToken * CACHE_READ_MULTIPLIER +
    tally.cacheWrite5mTokens * perInputToken * CACHE_WRITE_5M_MULTIPLIER +
    tally.cacheWrite1hTokens * perInputToken * CACHE_WRITE_1H_MULTIPLIER
  )
}
