import type { TabStatus } from '../../../shared/ipc'
import type { LiveTab } from './usePanes'

// Supervision slice 4. One list of every session actually waiting on a human.
//
// The distinction this depends on already exists in main: status-hub scans a
// settled buffer against the tool's approval patterns and reports `needsYou`
// when it matched a prompt, `idle` when it did not. So "waiting at a prompt"
// and "finished and quiet" are already separate — this only aggregates them.
//
// Pure over the tab list and the status map, so the rules are asserted directly
// rather than inferred from a rendered sidebar.

export interface BlockedSession {
  ptyId: string
  paneId: string
  conversationId: string
  title: string
  status: TabStatus
}

// `needsYou` is a session sitting at a prompt: it cannot proceed without you.
// `failed` is included because it is equally stuck and equally invisible at
// eight tabs — but `idle` is NOT: a quiet session that finished is not blocked,
// and putting it here would make the list mean "sessions" rather than "sessions
// waiting", which is the whole point.
const BLOCKING: ReadonlySet<TabStatus> = new Set<TabStatus>(['needsYou', 'failed'])

export function isBlocking(status: TabStatus | undefined | null): boolean {
  return !!status && BLOCKING.has(status)
}

// Order: needsYou before failed. A session waiting on an answer is costing you
// throughput right now; a failed one has already stopped costing anything.
const RANK: Record<string, number> = { needsYou: 0, failed: 1 }

export function blockedSessions(
  tabs: { paneId: string; tab: LiveTab }[],
  statuses: Record<string, TabStatus>
): BlockedSession[] {
  const out: BlockedSession[] = []
  for (const { paneId, tab } of tabs) {
    // A composer has not launched and a review tab has no pty, so neither can
    // be waiting on anything. An exited tab is done, whatever its last status.
    if (tab.kind === 'composer' || tab.kind === 'review') continue
    if (tab.exited) continue
    const status = statuses[tab.ptyId]
    if (!isBlocking(status)) continue
    out.push({
      ptyId: tab.ptyId,
      paneId,
      conversationId: tab.conversationId,
      title: tab.title,
      status: status as TabStatus
    })
  }
  return out.sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9))
}

// The heading. Says the count plainly rather than relying on a badge, so the
// state is never carried by a coloured dot alone.
export function blockedSummary(sessions: BlockedSession[]): string {
  if (sessions.length === 0) return ''
  const waiting = sessions.filter((s) => s.status === 'needsYou').length
  const failed = sessions.length - waiting
  const parts: string[] = []
  if (waiting > 0) parts.push(`${waiting} waiting on you`)
  if (failed > 0) parts.push(`${failed} failed`)
  return parts.join(', ')
}
