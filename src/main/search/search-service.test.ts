import { describe, it, expect, vi } from 'vitest'
import {
  searchConversations,
  MAX_SESSIONS_SCANNED,
  MAX_HITS,
  MAX_MATCHES_PER_SESSION,
  type SearchableConversation
} from './search-service'

const conv = (over: Partial<SearchableConversation> = {}): SearchableConversation => ({
  id: 'c1',
  title: 'Session one',
  tool: 'claude',
  projectId: 'p1',
  cwd: '/repo',
  agentSessionId: 'sid-1',
  lastActiveAt: 1000,
  archivedAt: null,
  ...over
})

const userLine = (text: string): string => JSON.stringify({ type: 'user', message: { content: text } })

// A fake reader keyed by session id, so the test states which transcript each
// session has without touching disk.
const reader = (byId: Record<string, string>) => (c: { agentSessionId: string | null }): string | null =>
  (c.agentSessionId && byId[c.agentSessionId]) || null

describe('searchConversations', () => {
  it('returns nothing for an empty query without reading anything', () => {
    const read = vi.fn(() => null)
    const out = searchConversations([conv()], '   ', { read })
    expect(out.hits).toEqual([])
    expect(read).not.toHaveBeenCalled()
  })

  it('finds a session by its transcript content', () => {
    const out = searchConversations([conv()], 'comparator', {
      read: reader({ 'sid-1': userLine('fix the sync comparator') })
    })
    expect(out.hits).toHaveLength(1)
    expect(out.hits[0].conversationId).toBe('c1')
    expect(out.hits[0].matches[0].excerpt).toContain('comparator')
  })

  it('INCLUDES archived sessions, since the point is finding a closed one', () => {
    const out = searchConversations([conv({ archivedAt: 123 })], 'needle', {
      read: reader({ 'sid-1': userLine('a needle here') })
    })
    expect(out.hits).toHaveLength(1)
  })

  it('skips conversations with no agent session id', () => {
    const read = vi.fn(() => userLine('needle'))
    const out = searchConversations([conv({ agentSessionId: null })], 'needle', { read })
    expect(out.hits).toEqual([])
    expect(read).not.toHaveBeenCalled()
  })

  it('skips a session whose transcript cannot be read', () => {
    const out = searchConversations([conv()], 'needle', { read: () => null })
    expect(out.hits).toEqual([])
    expect(out.sessionsScanned).toBe(1)
  })

  it('scans NEWEST FIRST, so the cap bites the least likely candidates', () => {
    const seen: string[] = []
    searchConversations(
      [conv({ id: 'old', agentSessionId: 'a', lastActiveAt: 1 }), conv({ id: 'new', agentSessionId: 'b', lastActiveAt: 99 })],
      'needle',
      {
        read: (c) => {
          seen.push(c.agentSessionId!)
          return null
        }
      }
    )
    expect(seen).toEqual(['b', 'a'])
  })

  it('carries what a caller needs to reopen the session', () => {
    const out = searchConversations([conv({ tool: 'claude', cwd: '/x', projectId: 'p9' })], 'needle', {
      read: reader({ 'sid-1': userLine('needle') })
    })
    expect(out.hits[0]).toMatchObject({ tool: 'claude', cwd: '/x', projectId: 'p9', agentSessionId: 'sid-1' })
  })

  it('caps matches per session so one chatty session cannot fill the list', () => {
    const many = Array.from({ length: 20 }, (_, i) => userLine(`needle ${i}`)).join('\n')
    const out = searchConversations([conv()], 'needle', { read: reader({ 'sid-1': many }) })
    expect(out.hits[0].matches).toHaveLength(MAX_MATCHES_PER_SESSION)
  })

  it('caps how many sessions it opens and REPORTS what it skipped', () => {
    const convs = Array.from({ length: MAX_SESSIONS_SCANNED + 25 }, (_, i) =>
      conv({ id: `c${i}`, agentSessionId: `s${i}`, lastActiveAt: i })
    )
    const out = searchConversations(convs, 'needle', { read: () => null })
    expect(out.sessionsScanned).toBe(MAX_SESSIONS_SCANNED)
    // A silently short list would read as "that's all there is".
    expect(out.sessionsSkipped).toBe(25)
  })

  it('reports zero skipped when it scanned everything', () => {
    const out = searchConversations([conv(), conv({ id: 'c2', agentSessionId: 's2' })], 'needle', {
      read: () => null
    })
    expect(out.sessionsSkipped).toBe(0)
  })

  it('flags truncation when the total hit cap is reached', () => {
    const perSession = Array.from({ length: MAX_MATCHES_PER_SESSION }, (_, i) => userLine(`needle ${i}`)).join('\n')
    const n = Math.ceil(MAX_HITS / MAX_MATCHES_PER_SESSION) + 2
    const convs = Array.from({ length: n }, (_, i) => conv({ id: `c${i}`, agentSessionId: `s${i}`, lastActiveAt: i }))
    const out = searchConversations(convs, 'needle', { read: () => perSession })
    expect(out.hitsTruncated).toBe(true)
  })

  it('does not flag truncation for a small result set', () => {
    const out = searchConversations([conv()], 'needle', { read: reader({ 'sid-1': userLine('needle') }) })
    expect(out.hitsTruncated).toBe(false)
  })

  it('searches each tool with its own format', () => {
    const out = searchConversations(
      [
        conv({ id: 'a', tool: 'claude', agentSessionId: 'sa' }),
        conv({ id: 'b', tool: 'codex', agentSessionId: 'sb' })
      ],
      'needle',
      {
        read: reader({
          sa: userLine('needle in claude'),
          sb: JSON.stringify({ payload: { type: 'user_message', message: 'needle in codex' } })
        })
      }
    )
    expect(out.hits.map((h) => h.conversationId).sort()).toEqual(['a', 'b'])
  })
})
