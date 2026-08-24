import { describe, it, expect } from 'vitest'
import { blockedSessions, blockedSummary, isBlocking } from './blocked-inbox'
import type { LiveTab } from './usePanes'
import type { TabStatus } from '../../../shared/ipc'

const tab = (over: Partial<LiveTab> = {}): { paneId: string; tab: LiveTab } => ({
  paneId: 'pane-1',
  tab: {
    ptyId: 'p1',
    conversationId: 'c1',
    title: 'Fix the thing',
    kind: 'terminal',
    ...over
  } as LiveTab
})

describe('isBlocking', () => {
  it('counts a session waiting at a prompt', () => {
    expect(isBlocking('needsYou')).toBe(true)
  })

  it('counts a failed session, which is equally stuck', () => {
    expect(isBlocking('failed')).toBe(true)
  })

  it('does NOT count idle — quiet and finished is not blocked', () => {
    // The whole point of the list is "waiting on you". Including idle would
    // make it a list of sessions, which the tab strip already is.
    expect(isBlocking('idle')).toBe(false)
  })

  it('does not count a working session', () => {
    expect(isBlocking('working')).toBe(false)
  })

  it('does not count needsReview', () => {
    expect(isBlocking('needsReview')).toBe(false)
  })

  it('treats an unknown status as not blocking', () => {
    expect(isBlocking(undefined)).toBe(false)
    expect(isBlocking(null)).toBe(false)
  })
})

describe('blockedSessions', () => {
  it('is empty when nothing is waiting', () => {
    expect(blockedSessions([tab()], { p1: 'working' })).toEqual([])
  })

  it('collects a session waiting at a prompt', () => {
    const out = blockedSessions([tab()], { p1: 'needsYou' })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ ptyId: 'p1', paneId: 'pane-1', title: 'Fix the thing', status: 'needsYou' })
  })

  it('ignores a composer, which has not launched anything yet', () => {
    expect(blockedSessions([tab({ kind: 'composer' })], { p1: 'needsYou' })).toEqual([])
  })

  it('ignores a review tab, which has no pty to be blocked on', () => {
    expect(blockedSessions([tab({ kind: 'review' })], { p1: 'needsYou' })).toEqual([])
  })

  it('ignores an exited tab whatever its last status was', () => {
    expect(blockedSessions([tab({ exited: true })], { p1: 'failed' })).toEqual([])
  })

  it('ignores a tab with no reported status', () => {
    expect(blockedSessions([tab()], {})).toEqual([])
  })

  it('ORDERS waiting-on-you ahead of failed', () => {
    // A session waiting on an answer is costing throughput now; a failed one
    // has already stopped costing anything.
    const out = blockedSessions(
      [tab({ ptyId: 'a' }), tab({ ptyId: 'b' })],
      { a: 'failed' as TabStatus, b: 'needsYou' as TabStatus }
    )
    expect(out.map((s) => s.ptyId)).toEqual(['b', 'a'])
  })

  it('collects across panes', () => {
    const out = blockedSessions(
      [
        { ...tab({ ptyId: 'a' }), paneId: 'pane-1' },
        { ...tab({ ptyId: 'b' }), paneId: 'pane-2' }
      ],
      { a: 'needsYou', b: 'needsYou' }
    )
    expect(out.map((s) => s.paneId).sort()).toEqual(['pane-1', 'pane-2'])
  })
})

describe('blockedSummary', () => {
  it('is empty for nothing blocked', () => {
    expect(blockedSummary([])).toBe('')
  })

  it('states the waiting count in words, not just a badge', () => {
    const out = blockedSessions([tab()], { p1: 'needsYou' })
    expect(blockedSummary(out)).toBe('1 waiting on you')
  })

  it('reports both kinds when both are present', () => {
    const out = blockedSessions(
      [tab({ ptyId: 'a' }), tab({ ptyId: 'b' }), tab({ ptyId: 'c' })],
      { a: 'needsYou', b: 'needsYou', c: 'failed' }
    )
    expect(blockedSummary(out)).toBe('2 waiting on you, 1 failed')
  })

  it('omits a zero count rather than saying "0 failed"', () => {
    const out = blockedSessions([tab()], { p1: 'failed' })
    expect(blockedSummary(out)).toBe('1 failed')
  })
})
