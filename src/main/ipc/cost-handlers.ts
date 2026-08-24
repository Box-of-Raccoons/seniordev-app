import { ipcMain } from 'electron'
import { COST, type ConversationCostInfo } from '../../shared/ipc'
import { costForConversation } from '../cost/cost-service'
import { DEFAULT_RATES, type ModelRate } from '../cost/pricing'
import type { SessionPersistence } from '../session-persistence'
import type { ConfigSource } from '../config/store'

// Supervision slice 3a. Read-only: prices each conversation from its own agent
// transcript. Config rates merge OVER the bundled table so a user can correct a
// stale price or add a model without losing the defaults for everything else.
export function resolveRates(config: { modelRates?: Record<string, ModelRate> } | null): Record<string, ModelRate> {
  return { ...DEFAULT_RATES, ...(config?.modelRates ?? {}) }
}

export function registerCostIpc(deps: {
  persistence: SessionPersistence
  source: ConfigSource
}): void {
  ipcMain.handle(COST.list, (): ConversationCostInfo[] => {
    const rates = resolveRates(deps.source.config)
    const out: ConversationCostInfo[] = []
    for (const c of deps.persistence.conversations.list()) {
      // A conversation whose agent never wrote a transcript costs nothing;
      // reading it is cheap enough that filtering first would only hide it.
      const cost = costForConversation({ id: c.id, tool: c.tool, agentSessionId: c.agentSessionId }, { rates })
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
    return out
  })
}
