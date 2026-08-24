import { readTranscript } from '../transcripts'
import { searchTranscript, type TranscriptMatch } from './transcript-search'

// Supervision slice 5. Walks every known conversation's transcript and searches
// it. No index: an on-demand scan has no staleness and nothing to invalidate,
// and the design doc's instruction was to measure at real volume before
// building one. The caps below are what keep an unmeasured scan honest.

// A scan reads whole transcript files, so it is bounded twice: by how many
// sessions it will open, and by how many hits it will collect. Both report
// what they dropped rather than returning a silently short list.
export const MAX_SESSIONS_SCANNED = 300
export const MAX_HITS = 100
export const MAX_MATCHES_PER_SESSION = 5

export interface SearchableConversation {
  id: string
  title: string
  tool: string
  projectId: string
  cwd: string
  agentSessionId: string | null
  lastActiveAt: number
  archivedAt: number | null
}

export interface SessionHit {
  conversationId: string
  title: string
  tool: string
  projectId: string
  cwd: string
  agentSessionId: string | null
  matches: TranscriptMatch[]
}

export interface SearchOutcome {
  hits: SessionHit[]
  sessionsScanned: number
  // Sessions not opened because the scan cap was reached. Non-zero means the
  // result set is incomplete, and the UI must say so.
  sessionsSkipped: number
  hitsTruncated: boolean
}

export function searchConversations(
  conversations: SearchableConversation[],
  query: string,
  opts?: {
    deps?: { claudeProjectsDir?: string; codexSessionsDir?: string }
    read?: (conv: { tool: string; agentSessionId: string | null }) => string | null
  }
): SearchOutcome {
  const empty: SearchOutcome = { hits: [], sessionsScanned: 0, sessionsSkipped: 0, hitsTruncated: false }
  if (!query.trim()) return empty

  const read = opts?.read ?? ((c): string | null => readTranscript(c, opts?.deps))

  // Newest first: the session you are trying to remember is far more often a
  // recent one, so the scan cap bites on the least likely candidates.
  // ARCHIVED SESSIONS ARE INCLUDED — searching only open tabs would defeat the
  // point ("which session did I fix that in" is usually about a closed one).
  const ordered = [...conversations]
    .filter((c) => c.agentSessionId)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)

  const hits: SessionHit[] = []
  let scanned = 0
  let totalMatches = 0
  let truncated = false

  for (const conv of ordered) {
    if (scanned >= MAX_SESSIONS_SCANNED) break
    if (totalMatches >= MAX_HITS) {
      truncated = true
      break
    }
    scanned++
    const text = read(conv)
    if (!text) continue
    const matches = searchTranscript(conv.tool, text, query, MAX_MATCHES_PER_SESSION)
    if (matches.length === 0) continue
    hits.push({
      conversationId: conv.id,
      title: conv.title,
      tool: conv.tool,
      projectId: conv.projectId,
      cwd: conv.cwd,
      agentSessionId: conv.agentSessionId,
      matches
    })
    totalMatches += matches.length
  }

  return {
    hits,
    sessionsScanned: scanned,
    sessionsSkipped: Math.max(0, ordered.length - scanned),
    hitsTruncated: truncated || totalMatches >= MAX_HITS
  }
}
