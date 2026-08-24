import { ipcMain } from 'electron'
import { SEARCH, type SearchResultInfo } from '../../shared/ipc'
import { searchConversations } from '../search/search-service'
import type { SessionPersistence } from '../session-persistence'

// Supervision slice 5. Read-only: opens transcripts and matches text. The scan
// runs in main because that is where the file access lives; it is bounded by
// the service's caps, and the result reports what those caps dropped.
export function registerSearchIpc(deps: { persistence: SessionPersistence }): void {
  ipcMain.handle(SEARCH.run, (_e, query: string): SearchResultInfo => {
    // Archived conversations are deliberately NOT filtered out here — the whole
    // point is finding a session that is no longer open.
    const conversations = deps.persistence.conversations.list()
    const out = searchConversations(conversations, query ?? '')
    return {
      hits: out.hits.map((h) => ({
        conversationId: h.conversationId,
        title: h.title,
        tool: h.tool,
        projectId: h.projectId,
        cwd: h.cwd,
        agentSessionId: h.agentSessionId,
        matches: h.matches
      })),
      sessionsScanned: out.sessionsScanned,
      sessionsSkipped: out.sessionsSkipped,
      hitsTruncated: out.hitsTruncated
    }
  })
}
