import type { ConversationCostInfo } from '../../shared/ipc'

// Display helpers for the notional cost readout (supervision slice 3a). Pure,
// so the "this is not a bill" wording is asserted rather than eyeballed.

// Compact token counts: a session runs to millions, and "8525033" on a sidebar
// row is unreadable.
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`
}

// Sub-cent sessions are common and "$0.00" reads as free, which is misleading
// when the point is comparing sessions against each other.
export function formatCost(usd: number | null): string {
  if (usd === null) return '—'
  if (usd === 0) return '$0'
  if (usd < 0.01) return '<$0.01'
  if (usd < 10) return `$${usd.toFixed(2)}`
  return `$${usd.toFixed(0)}`
}

// The label a cost figure carries. NOT a bill: work here runs on a
// subscription, so this is the API-equivalent price of the same tokens.
// Comparable between sessions, meaningless as an invoice — and the tooltip is
// where that gets said rather than assumed.
export function costTitle(info: ConversationCostInfo): string {
  const parts: string[] = []
  parts.push(`${formatTokens(info.mainTokens)} tokens over ${info.messages} message${info.messages === 1 ? '' : 's'}`)
  if (info.sidechainTokens > 0) {
    parts.push(`subagents: ${formatTokens(info.sidechainTokens)} tokens (${formatCost(info.sidechainCost)})`)
  }
  if (info.models.length > 0) parts.push(`models: ${info.models.join(', ')}`)
  if (info.unpricedModels.length > 0) {
    parts.push(`no known price for ${info.unpricedModels.join(', ')}, so no cost is shown`)
  }
  parts.push('Notional API-equivalent cost, not a bill')
  return parts.join(' · ')
}

// The one-line figure for a row. Subagent spend is added in because the row is
// about what the session cost in total; the split lives in the tooltip.
export function costLabel(info: ConversationCostInfo): string {
  const tokens = formatTokens(info.mainTokens + info.sidechainTokens)
  if (info.mainCost === null || info.sidechainCost === null) return tokens
  return `${tokens} · ${formatCost(info.mainCost + info.sidechainCost)}`
}
