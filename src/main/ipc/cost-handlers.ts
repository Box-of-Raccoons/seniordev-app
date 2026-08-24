import { ipcMain } from 'electron'
import { COST, type ConversationCostInfo } from '../../shared/ipc'
import { costForConversation, type ConversationCost } from '../cost/cost-service'
import { DEFAULT_RATES, type ModelRate } from '../cost/pricing'
import { locateTranscript, transcriptStamp } from '../transcripts'
import type { SessionPersistence } from '../session-persistence'
import type { ConfigSource } from '../config/store'

// Supervision slice 3a. Read-only: prices each conversation from its own agent
// transcript. Config rates merge OVER the bundled table so a user can correct a
// stale price or add a model without losing the defaults for everything else.
export function resolveRates(config: { modelRates?: Record<string, ModelRate> } | null): Record<string, ModelRate> {
  return { ...DEFAULT_RATES, ...(config?.modelRates ?? {}) }
}

// Pricing means reading and parsing whole transcripts, which run to tens of
// megabytes, and the sidebar re-asks on every change nudge. Re-reading an
// unchanged file each time is the difference between a snappy sidebar and one
// that stalls main. Size plus mtime is enough: a transcript is append-only, so
// any new content moves both.
interface CacheEntry {
  mtimeMs: number
  size: number
  ratesKey: string
  cost: ConversationCost
}

export function registerCostIpc(deps: {
  persistence: SessionPersistence
  source: ConfigSource
  // Injectable so a test can point at a fixture tree rather than the real HOME.
  claudeProjectsDir?: string
  codexSessionsDir?: string
}): void {
  const cache = new Map<string, CacheEntry>()

  ipcMain.handle(COST.list, (): ConversationCostInfo[] => {
    const rates = resolveRates(deps.source.config)
    // Rates are part of the cached answer, so a config edit must invalidate it.
    const ratesKey = JSON.stringify(rates)
    const dirs = { claudeProjectsDir: deps.claudeProjectsDir, codexSessionsDir: deps.codexSessionsDir }
    const out: ConversationCostInfo[] = []
    const live = new Set<string>()

    for (const c of deps.persistence.conversations.list()) {
      live.add(c.id)
      const conv = { id: c.id, tool: c.tool, agentSessionId: c.agentSessionId }
      const path = locateTranscript(conv, dirs)
      const stamp = path ? transcriptStamp(path) : null

      let cost: ConversationCost
      const hit = cache.get(c.id)
      if (hit && stamp && hit.mtimeMs === stamp.mtimeMs && hit.size === stamp.size && hit.ratesKey === ratesKey) {
        cost = hit.cost
      } else {
        cost = costForConversation(conv, { rates, ...dirs })
        if (stamp) cache.set(c.id, { ...stamp, ratesKey, cost })
        else cache.delete(c.id)
      }

      // A conversation whose agent never wrote a transcript costs nothing.
      if (cost.main.tokens === 0 && cost.sidechain.tokens === 0) continue
      out.push({
        conversationId: cost.conversationId,
        mainTokens: cost.main.tokens,
        mainCost: cost.main.cost,
        sidechainTokens: cost.sidechain.tokens,
        sidechainCost: cost.sidechain.cost,
        unpricedModels: [...new Set([...cost.main.unpricedModels, ...cost.sidechain.unpricedModels])],
        messages: cost.messages,
        models: cost.models
      })
    }

    // Drop cache entries for conversations that no longer exist, so a long
    // session does not accumulate them forever.
    for (const key of cache.keys()) if (!live.has(key)) cache.delete(key)

    return out
  })
}
