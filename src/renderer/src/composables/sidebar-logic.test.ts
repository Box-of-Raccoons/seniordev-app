import { describe, it, expect } from 'vitest'
import {
  activeProjectsByRecency,
  archivedProjects,
  conversationsForProject,
  capConversations,
  rowState,
  conversationDragPayload,
  resumeTabSpec,
  conversationDropAction,
  teardownOffersWorktree,
  type CapLevel
} from './sidebar-logic'
import type { ProjectInfo, ConversationInfo } from '../../../shared/ipc'

function proj(over: Partial<ProjectInfo>): ProjectInfo {
  return {
    id: 'p', title: 't', path: '/p', defaultTool: 'claude', worktreeDefault: false,
    lastActiveAt: 0, archivedAt: null, createdAt: 0, updatedAt: 0, ...over
  }
}
function conv(over: Partial<ConversationInfo>): ConversationInfo {
  return {
    id: 'c', projectId: 'p', title: 't', tool: 'claude', agentSessionId: 'sid', resumable: true,
    cwd: '/p', worktreePath: null, branch: null, lastActiveAt: 0, createdAt: 0, archivedAt: null, ...over
  }
}

describe('activeProjectsByRecency', () => {
  it('drops archived and sorts by lastActiveAt desc', () => {
    const list = [
      proj({ id: 'a', lastActiveAt: 10 }),
      proj({ id: 'b', lastActiveAt: 30 }),
      proj({ id: 'c', lastActiveAt: 20, archivedAt: 5 }), // archived → excluded
      proj({ id: 'd', lastActiveAt: 20 })
    ]
    expect(activeProjectsByRecency(list).map((p) => p.id)).toEqual(['b', 'd', 'a'])
  })

  it('breaks ties on id for a stable order and does not mutate the input', () => {
    const list = [proj({ id: 'y', lastActiveAt: 5 }), proj({ id: 'x', lastActiveAt: 5 })]
    const snapshot = list.map((p) => p.id)
    expect(activeProjectsByRecency(list).map((p) => p.id)).toEqual(['x', 'y'])
    expect(list.map((p) => p.id)).toEqual(snapshot) // slice() → input untouched
  })
})

describe('archivedProjects', () => {
  it('keeps only archived, most-recently-archived first', () => {
    const list = [
      proj({ id: 'a', archivedAt: 100 }),
      proj({ id: 'b' }), // active → excluded
      proj({ id: 'c', archivedAt: 300 }),
      proj({ id: 'd', archivedAt: 200 })
    ]
    expect(archivedProjects(list).map((p) => p.id)).toEqual(['c', 'd', 'a'])
  })
})

describe('conversationsForProject', () => {
  it('filters by project + non-archived and sorts by recency', () => {
    const list = [
      conv({ id: '1', projectId: 'p', lastActiveAt: 10 }),
      conv({ id: '2', projectId: 'other', lastActiveAt: 99 }),
      conv({ id: '3', projectId: 'p', lastActiveAt: 30 }),
      conv({ id: '4', projectId: 'p', lastActiveAt: 20, archivedAt: 1 })
    ]
    expect(conversationsForProject(list, 'p').map((c) => c.id)).toEqual(['3', '1'])
  })
})

describe('capConversations', () => {
  const mk = (n: number): number[] => Array.from({ length: n }, (_, i) => i)

  it('collapsed shows all when 5 or fewer, with no control', () => {
    expect(capConversations(mk(5), 'collapsed')).toEqual({ visible: mk(5), next: null })
    expect(capConversations(mk(3), 'collapsed')).toEqual({ visible: mk(3), next: null })
  })

  it('collapsed clips to 5 and offers "more" when there are more', () => {
    const { visible, next } = capConversations(mk(7), 'collapsed')
    expect(visible).toHaveLength(5)
    expect(next).toBe('more')
  })

  it('more shows up to 10, offering "all" only past 10', () => {
    expect(capConversations(mk(8), 'more')).toEqual({ visible: mk(8), next: null }) // 8 ≤ 10
    const { visible, next } = capConversations(mk(14), 'more')
    expect(visible).toHaveLength(10)
    expect(next).toBe('all')
  })

  it('all shows everything with no further control', () => {
    const { visible, next } = capConversations(mk(50), 'all')
    expect(visible).toHaveLength(50)
    expect(next).toBeNull()
  })

  it('advances collapsed → more → all as the control is followed', () => {
    const list = mk(30)
    let level: CapLevel = 'collapsed'
    let step = capConversations(list, level)
    expect(step.visible).toHaveLength(5)
    level = step.next!
    step = capConversations(list, level)
    expect(step.visible).toHaveLength(10)
    level = step.next!
    step = capConversations(list, level)
    expect(step.visible).toHaveLength(30)
    expect(step.next).toBeNull()
  })
})

describe('rowState', () => {
  it('open when a live tab exists, carrying its ptyId + paneId', () => {
    expect(rowState(conv({ resumable: true }), { ptyId: 'pty1', paneId: 'pane1' })).toEqual({
      open: true, ptyId: 'pty1', paneId: 'pane1', resumable: true
    })
  })

  it('closed + resumable when no live tab but the conversation is resumable', () => {
    expect(rowState(conv({ resumable: true }), null)).toEqual({
      open: false, ptyId: null, paneId: null, resumable: true
    })
  })

  it('closed + not resumable when the computed flag is false (empty session)', () => {
    // The regression case: an id may be present, but with no persisted transcript
    // the main-side check returns resumable:false, so the row is inert.
    expect(rowState(conv({ resumable: false }), null)).toEqual({
      open: false, ptyId: null, paneId: null, resumable: false
    })
  })

  it('a non-resumable conversation can still be open (live tab, focusable)', () => {
    expect(rowState(conv({ resumable: false }), { ptyId: 'p', paneId: 'pane' })).toEqual({
      open: true, ptyId: 'p', paneId: 'pane', resumable: false
    })
  })
})

describe('conversation drag helpers', () => {
  it('conversationDragPayload carries just what a resume needs', () => {
    const c = conv({ id: 'c9', title: 'x', tool: 'codex', cwd: '/w', agentSessionId: 'sid9' })
    expect(conversationDragPayload(c)).toEqual({ id: 'c9', title: 'x', tool: 'codex', cwd: '/w', agentSessionId: 'sid9' })
  })

  it('resumeTabSpec reuses the record id and drives resume', () => {
    expect(resumeTabSpec({ id: 'c1', title: 'w', tool: 'claude', cwd: '/r', agentSessionId: 'sess' })).toEqual({
      title: 'w', kind: 'terminal', variant: 'agent', tool: 'claude',
      conversationId: 'c1', resume: { sessionId: 'sess' }, cwdOverride: '/r'
    })
  })

  it('resumeTabSpec falls back to a default title', () => {
    expect(resumeTabSpec({ id: 'c1', title: '', tool: 'claude', cwd: '/r', agentSessionId: 's' }).title).toBe('session')
  })

  it('conversationDropAction: live tab → move, dead+resumable → resume, non-resumable → none', () => {
    expect(conversationDropAction({ agentSessionId: 'sid' }, { ptyId: 'pty7' })).toEqual({ action: 'move', ptyId: 'pty7' })
    expect(conversationDropAction({ agentSessionId: 'sid' }, null)).toEqual({ action: 'resume' })
    expect(conversationDropAction({ agentSessionId: null }, null)).toEqual({ action: 'none' })
    // A live but not-yet-resumable tab still moves (focus/relocate its pty).
    expect(conversationDropAction({ agentSessionId: null }, { ptyId: 'p' })).toEqual({ action: 'move', ptyId: 'p' })
  })
})

describe('teardownOffersWorktree', () => {
  it('is true only when the conversation ran in a worktree', () => {
    expect(teardownOffersWorktree(conv({ worktreePath: '/wt/x' }))).toBe(true)
    expect(teardownOffersWorktree(conv({ worktreePath: null }))).toBe(false)
  })
})
