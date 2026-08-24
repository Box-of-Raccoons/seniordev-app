import { describe, it, expect } from 'vitest'
import {
  costFor,
  rateFor,
  addTally,
  emptyTally,
  totalTokens,
  DEFAULT_RATES,
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_5M_MULTIPLIER,
  CACHE_WRITE_1H_MULTIPLIER,
  type TokenTally
} from './pricing'

const tally = (over: Partial<TokenTally> = {}): TokenTally => ({ ...emptyTally(), ...over })

describe('rateFor', () => {
  it('matches an exact model id', () => {
    expect(rateFor('claude-opus-5', DEFAULT_RATES)).toEqual({ input: 5, output: 25 })
  })

  it('matches a dated snapshot id by prefix', () => {
    // Transcripts can carry claude-haiku-4-5-20251001 where the table has the alias.
    expect(rateFor('claude-haiku-4-5-20251001', DEFAULT_RATES)).toEqual({ input: 1, output: 5 })
  })

  it('prefers the LONGEST matching prefix', () => {
    const rates = { 'claude-opus': { input: 1, output: 1 }, 'claude-opus-5': { input: 5, output: 25 } }
    expect(rateFor('claude-opus-5', rates)).toEqual({ input: 5, output: 25 })
  })

  it('returns null for an unknown model rather than guessing', () => {
    expect(rateFor('gpt-5', DEFAULT_RATES)).toBeNull()
  })

  it('returns null for an empty model', () => {
    expect(rateFor('', DEFAULT_RATES)).toBeNull()
  })
})

describe('costFor', () => {
  it('prices plain input and output at the model rate', () => {
    // 1M input at $5 + 1M output at $25 on Opus 5.
    const c = costFor(tally({ inputTokens: 1_000_000, outputTokens: 1_000_000 }), 'claude-opus-5')
    expect(c).toBeCloseTo(30, 6)
  })

  it('prices cache reads at a tenth of the input rate', () => {
    const c = costFor(tally({ cacheReadTokens: 1_000_000 }), 'claude-opus-5')
    expect(c).toBeCloseTo(5 * CACHE_READ_MULTIPLIER, 6)
  })

  it('prices the two cache-write tiers DIFFERENTLY', () => {
    // The whole reason the tiers are tracked separately: 1.25x vs 2x.
    const short = costFor(tally({ cacheWrite5mTokens: 1_000_000 }), 'claude-opus-5')!
    const long = costFor(tally({ cacheWrite1hTokens: 1_000_000 }), 'claude-opus-5')!
    expect(short).toBeCloseTo(5 * CACHE_WRITE_5M_MULTIPLIER, 6)
    expect(long).toBeCloseTo(5 * CACHE_WRITE_1H_MULTIPLIER, 6)
    expect(long).toBeGreaterThan(short)
  })

  it('sums every component', () => {
    const c = costFor(
      tally({
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        cacheWrite5mTokens: 1_000_000,
        cacheWrite1hTokens: 1_000_000
      }),
      'claude-opus-5'
    )!
    expect(c).toBeCloseTo(5 + 25 + 0.5 + 6.25 + 10, 6)
  })

  it('is zero for a session that used nothing', () => {
    expect(costFor(emptyTally(), 'claude-opus-5')).toBe(0)
  })

  it('returns null for an unpriced model rather than a wrong number', () => {
    expect(costFor(tally({ outputTokens: 5000 }), 'some-other-model')).toBeNull()
  })

  it('lets config override a bundled rate', () => {
    const c = costFor(tally({ inputTokens: 1_000_000 }), 'claude-opus-5', {
      ...DEFAULT_RATES,
      'claude-opus-5': { input: 99, output: 1 }
    })
    expect(c).toBeCloseTo(99, 6)
  })

  it('lets config price a model the bundled table has never heard of', () => {
    const c = costFor(tally({ inputTokens: 1_000_000 }), 'gpt-5', { 'gpt-5': { input: 2, output: 8 } })
    expect(c).toBeCloseTo(2, 6)
  })

  it('prices a cheaper model lower for identical usage', () => {
    const t = tally({ inputTokens: 1_000_000, outputTokens: 1_000_000 })
    expect(costFor(t, 'claude-haiku-4-5')!).toBeLessThan(costFor(t, 'claude-opus-5')!)
  })
})

describe('tally arithmetic', () => {
  it('adds every field', () => {
    const sum = addTally(
      tally({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWrite5mTokens: 4, cacheWrite1hTokens: 5 }),
      tally({ inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWrite5mTokens: 40, cacheWrite1hTokens: 50 })
    )
    expect(sum).toEqual({
      inputTokens: 11,
      outputTokens: 22,
      cacheReadTokens: 33,
      cacheWrite5mTokens: 44,
      cacheWrite1hTokens: 55
    })
  })

  it('totals every token kind, since cache tokens are real tokens', () => {
    expect(
      totalTokens(
        tally({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWrite5mTokens: 4, cacheWrite1hTokens: 5 })
      )
    ).toBe(15)
  })

  it('starts empty at zero', () => {
    expect(totalTokens(emptyTally())).toBe(0)
  })
})
