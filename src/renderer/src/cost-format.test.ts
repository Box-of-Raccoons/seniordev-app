import { describe, it, expect } from 'vitest'
import { formatTokens, formatCost, costTitle, costLabel } from './cost-format'
import type { ConversationCostInfo } from '../../shared/ipc'

const info = (over: Partial<ConversationCostInfo> = {}): ConversationCostInfo => ({
  conversationId: 'c1',
  mainTokens: 1000,
  mainCost: 1,
  sidechainTokens: 0,
  sidechainCost: 0,
  unpricedModels: [],
  messages: 3,
  models: ['claude-opus-5'],
  ...over
})

describe('formatTokens', () => {
  it('shows small counts exactly', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(999)).toBe('999')
  })
  it('abbreviates thousands', () => {
    expect(formatTokens(1500)).toBe('1.5k')
    expect(formatTokens(85_000)).toBe('85k')
  })
  it('abbreviates millions, because a real session runs to millions', () => {
    expect(formatTokens(1_500_000)).toBe('1.5M')
    // A real measured session: keeps a decimal below 10M, where it still carries information.
    expect(formatTokens(8_525_033)).toBe('8.5M')
    expect(formatTokens(42_000_000)).toBe('42M')
  })
})

describe('formatCost', () => {
  it('renders an unpriced cost as a dash, never as zero', () => {
    // "$0.00" would read as free, which is a different claim than "unknown".
    expect(formatCost(null)).toBe('—')
  })
  it('distinguishes genuinely zero from sub-cent', () => {
    expect(formatCost(0)).toBe('$0')
    expect(formatCost(0.004)).toBe('<$0.01')
  })
  it('shows cents for small amounts and whole dollars for large', () => {
    expect(formatCost(1.234)).toBe('$1.23')
    expect(formatCost(13.6)).toBe('$14')
  })
})

describe('costTitle', () => {
  it('always says the figure is notional and not a bill', () => {
    expect(costTitle(info())).toMatch(/not a bill/i)
  })

  it('names the token count and message count', () => {
    expect(costTitle(info({ mainTokens: 2000, messages: 5 }))).toContain('2.0k tokens over 5 messages')
  })

  it('singularises one message', () => {
    expect(costTitle(info({ messages: 1 }))).toContain('over 1 message')
  })

  it('breaks out subagent spend when there is any', () => {
    const t = costTitle(info({ sidechainTokens: 500_000, sidechainCost: 2 }))
    expect(t).toMatch(/subagents: 500k tokens \(\$2\.00\)/)
  })

  it('omits the subagent line when there were none', () => {
    expect(costTitle(info())).not.toMatch(/subagents/)
  })

  it('names the models used', () => {
    expect(costTitle(info({ models: ['claude-opus-5', 'claude-fable-5'] }))).toContain(
      'models: claude-opus-5, claude-fable-5'
    )
  })

  it('explains WHY a cost is missing rather than leaving a bare dash', () => {
    expect(costTitle(info({ mainCost: null, unpricedModels: ['brand-new'] }))).toMatch(
      /no known price for brand-new/
    )
  })
})

describe('costLabel', () => {
  it('combines tokens and cost', () => {
    expect(costLabel(info({ mainTokens: 1_000_000, mainCost: 5 }))).toBe('1.0M · $5.00')
  })

  it('adds subagent spend into the row total', () => {
    expect(costLabel(info({ mainTokens: 1000, mainCost: 1, sidechainTokens: 1000, sidechainCost: 1 }))).toBe(
      '2.0k · $2.00'
    )
  })

  it('falls back to TOKENS ONLY when the cost is unknown', () => {
    // Tokens are never in doubt; only their price is.
    expect(costLabel(info({ mainCost: null }))).toBe('1.0k')
  })
})
