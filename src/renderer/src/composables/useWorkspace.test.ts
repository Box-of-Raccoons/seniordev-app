import { describe, it, expect } from 'vitest'
import { useWorkspace } from './useWorkspace'

// The A3 lift moved the shared state here; these guard the contract the sidebar
// and RightPanel both depend on. Behaviour (status listener, save, actions) is
// still tested through the components that own it.
describe('useWorkspace', () => {
  it('exposes a panes model, a status map, and sidebar geometry defaults', () => {
    const ws = useWorkspace()
    expect(ws.panes.panes).toHaveLength(1) // usePanes seeds one empty pane
    expect(ws.statuses).toEqual({})
    expect(ws.sidebarWidth.value).toBeNull()
    expect(ws.sidebarCollapsed.value).toBe(false)
  })

  it('the status map is reactive and keyed by ptyId', () => {
    const ws = useWorkspace()
    const tab = ws.panes.addTab({ title: 't', kind: 'terminal', variant: 'agent' })
    ws.statuses[tab.ptyId] = 'working'
    expect(ws.statuses[tab.ptyId]).toBe('working')
    // The sidebar reaches a tab's glyph via findByConversationId → ptyId → status.
    const live = ws.panes.findByConversationId(tab.conversationId)
    expect(live?.ptyId).toBe(tab.ptyId)
    expect(ws.statuses[live!.ptyId]).toBe('working')
  })

  it('each instance is independent (no shared module state)', () => {
    const a = useWorkspace()
    const b = useWorkspace()
    a.panes.addTab({ title: 't', kind: 'composer', variant: 'agent' })
    a.sidebarCollapsed.value = true
    expect(a.panes.hasTabs.value).toBe(true)
    expect(b.panes.hasTabs.value).toBe(false)
    expect(b.sidebarCollapsed.value).toBe(false)
  })
})
