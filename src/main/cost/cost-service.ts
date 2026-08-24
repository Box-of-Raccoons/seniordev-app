import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { claudeProjectsDir } from '../session-resumable'
import { codexSessionsDir } from '../codex/session-discovery'
import { parseClaudeUsage, parseCodexUsage, totalTally, emptyUsage, type TranscriptUsage } from './transcript-usage'
import { costFor, totalTokens, DEFAULT_RATES, type ModelRate, type TokenTally } from './pricing'

// Supervision slice 3a. Reads a conversation's own agent transcript and prices
// it. The file locations are the same internal contracts session-title.ts and
// session-resumable.ts already depend on; every read failure degrades to "no
// usage", which is the convention this codebase already uses for transcripts.

export interface CostBreakdown {
  // Total tokens across every kind (cache tokens are real tokens).
  tokens: number
  // Notional USD, or null when any model in the session has no known rate.
  // Null rather than a partial sum: a cost that silently omits a model reads
  // as a complete number and is not one.
  cost: number | null
  // Models that produced tokens but had no rate. Non-empty explains a null cost.
  unpricedModels: string[]
}

export interface ConversationCost {
  conversationId: string
  main: CostBreakdown
  // Subagent spend, separated. For an orchestrator workflow this is the
  // actionable number, not a detail.
  sidechain: CostBreakdown
  messages: number
  models: string[]
}

function priceEntries(
  entries: { model: string; tally: TokenTally }[],
  rates: Record<string, ModelRate>
): CostBreakdown {
  let tokens = 0
  let cost = 0
  const unpriced: string[] = []
  for (const e of entries) {
    tokens += totalTokens(e.tally)
    const c = costFor(e.tally, e.model, rates)
    if (c === null) unpriced.push(e.model || '(unknown)')
    else cost += c
  }
  return { tokens, cost: unpriced.length > 0 ? null : cost, unpricedModels: unpriced }
}

// Locate and read a claude transcript. Scans project subdirs for <id>.jsonl
// rather than deriving the hash from cwd, matching claudeHasTranscript — the
// path-encoding scheme is claude's, not ours, and could differ for odd cwds.
function readClaudeTranscript(sessionId: string, projectsDir: string): string | null {
  let dirs: string[]
  try {
    dirs = readdirSync(projectsDir)
  } catch {
    return null
  }
  for (const d of dirs) {
    try {
      return readFileSync(join(projectsDir, d, `${sessionId}.jsonl`), 'utf8')
    } catch {
      // Not in this project dir; keep scanning.
    }
  }
  return null
}

function readCodexTranscript(sessionId: string, sessionsDir: string): string | null {
  let entries: string[]
  try {
    entries = readdirSync(sessionsDir, { recursive: true }) as string[]
  } catch {
    return null
  }
  const idLc = sessionId.toLowerCase()
  for (const rel of entries) {
    const base = (rel.split(/[\\/]/).pop() ?? '').toLowerCase()
    if (!base.endsWith('.jsonl') || !base.includes(idLc)) continue
    try {
      return readFileSync(join(sessionsDir, rel), 'utf8')
    } catch {
      return null
    }
  }
  return null
}

export function usageForConversation(
  conv: { tool: string; agentSessionId: string | null },
  deps?: { claudeProjectsDir?: string; codexSessionsDir?: string }
): TranscriptUsage {
  if (!conv.agentSessionId) return emptyUsage()
  if (conv.tool === 'claude') {
    const text = readClaudeTranscript(conv.agentSessionId, deps?.claudeProjectsDir ?? claudeProjectsDir())
    return text ? parseClaudeUsage(text) : emptyUsage()
  }
  if (conv.tool === 'codex') {
    const text = readCodexTranscript(conv.agentSessionId, deps?.codexSessionsDir ?? codexSessionsDir())
    return text ? parseCodexUsage(text) : emptyUsage()
  }
  // A tool whose transcript format we do not know: report nothing rather than
  // guessing at another agent's file layout.
  return emptyUsage()
}

export function costForConversation(
  conv: { id: string; tool: string; agentSessionId: string | null },
  opts?: {
    rates?: Record<string, ModelRate>
    claudeProjectsDir?: string
    codexSessionsDir?: string
  }
): ConversationCost {
  const rates = opts?.rates ?? DEFAULT_RATES
  const usage = usageForConversation(conv, opts)
  return {
    conversationId: conv.id,
    main: priceEntries(usage.main, rates),
    sidechain: priceEntries(usage.sidechain, rates),
    messages: usage.assistantMessages,
    models: [...new Set([...usage.main, ...usage.sidechain].map((m) => m.model).filter(Boolean))]
  }
}

// Exported for the handler's summing; keeps the tally shape in one place.
export { totalTally }
