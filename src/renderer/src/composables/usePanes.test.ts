import { describe, it, expect } from 'vitest'
import { usePanes, type NewTab } from './usePanes'

// A minimal composer-kind tab; addTab mints ptyId + conversationId itself.
const composer: NewTab = { title: 'New session', kind: 'composer', variant: 'agent' }

function sumFractions(panes: { widthFraction: number }[]): number {
  return panes.reduce((s, p) => s + p.widthFraction, 0)
}

describe('usePanes model', () => {
  it('seeds with a single empty pane spanning the full width', () => {
    const p = usePanes()
    expect(p.panes).toHaveLength(1)
    expect(p.panes[0].tabs).toHaveLength(0)
    expect(p.panes[0].widthFraction).toBe(1)
    expect(p.hasTabs.value).toBe(false)
    expect(p.focusedPaneId.value).toBe(p.panes[0].id)
  })

  it('addTab mints a unique ptyId + conversationId and activates the tab', () => {
    const p = usePanes()
    const a = p.addTab(composer)
    const b = p.addTab(composer)
    expect(a.ptyId).toMatch(/^t\d+-/) // old scheme preserved for IPC + status key
    expect(a.ptyId).not.toBe(b.ptyId)
    expect(a.conversationId).toBeTruthy()
    expect(a.conversationId).not.toBe(b.conversationId)
    expect(p.panes[0].tabs).toHaveLength(2)
    expect(p.panes[0].activeTabId).toBe(b.ptyId) // last added is active
    expect(p.hasTabs.value).toBe(true)
  })

  it('allTabs is a flat list of every tab with its owning pane id', () => {
    const p = usePanes()
    const a = p.addTab(composer)
    const b = p.addTab(composer)
    p.moveToNewPane(b.ptyId, 'right')
    const flat = p.allTabs.value
    expect(flat.map((e) => e.tab.ptyId)).toEqual([a.ptyId, b.ptyId])
    expect(flat.find((e) => e.tab.ptyId === b.ptyId)?.paneId).toBe(p.panes[1].id)
  })

  it('closeTab repairs activeTabId to the last remaining tab', () => {
    const p = usePanes()
    const a = p.addTab(composer)
    const b = p.addTab(composer)
    p.closeTab(b.ptyId)
    expect(p.panes[0].tabs).toHaveLength(1)
    expect(p.panes[0].activeTabId).toBe(a.ptyId)
  })

  it('closing the last tab keeps the sole pane, emptied', () => {
    const p = usePanes()
    const a = p.addTab(composer)
    p.closeTab(a.ptyId)
    expect(p.panes).toHaveLength(1)
    expect(p.panes[0].tabs).toHaveLength(0)
    expect(p.panes[0].activeTabId).toBe(null)
    expect(p.hasTabs.value).toBe(false)
  })

  it('emptying a non-last pane removes it and redistributes width equally', () => {
    const p = usePanes()
    const a = p.addTab(composer)
    const b = p.addTab(composer)
    p.moveToNewPane(b.ptyId, 'right') // now two panes, 0.5 each
    expect(p.panes).toHaveLength(2)
    p.closeTab(b.ptyId) // second pane empties → removed
    expect(p.panes).toHaveLength(1)
    expect(p.panes[0].widthFraction).toBe(1)
    expect(p.panes[0].tabs.map((t) => t.ptyId)).toEqual([a.ptyId])
  })
})

describe('usePanes moves', () => {
  it('moveToNewPane splits off a column and fractions stay summed to 1', () => {
    const p = usePanes()
    p.addTab(composer)
    const b = p.addTab(composer)
    p.moveToNewPane(b.ptyId, 'right')
    expect(p.panes).toHaveLength(2)
    expect(p.panes[1].tabs.map((t) => t.ptyId)).toEqual([b.ptyId])
    expect(p.panes[0].widthFraction).toBeCloseTo(0.5)
    expect(sumFractions(p.panes)).toBeCloseTo(1)
    expect(p.focusedPaneId.value).toBe(p.panes[1].id)
  })

  it("moveToNewPane 'left' inserts the new pane at the front", () => {
    const p = usePanes()
    const a = p.addTab(composer)
    const b = p.addTab(composer)
    p.moveToNewPane(b.ptyId, 'left')
    expect(p.panes[0].tabs.map((t) => t.ptyId)).toEqual([b.ptyId])
    expect(p.panes[1].tabs.map((t) => t.ptyId)).toEqual([a.ptyId])
  })

  it('moving the only tab of the only pane to an edge is a no-op', () => {
    const p = usePanes()
    const a = p.addTab(composer)
    p.moveToNewPane(a.ptyId, 'right')
    expect(p.panes).toHaveLength(1)
    expect(p.panes[0].tabs.map((t) => t.ptyId)).toEqual([a.ptyId])
  })

  it('moveTab across panes cleans up an emptied source pane', () => {
    const p = usePanes()
    const a = p.addTab(composer)
    const b = p.addTab(composer)
    p.moveToNewPane(b.ptyId, 'right') // pane0=[a], pane1=[b]
    const pane0Id = p.panes[0].id
    p.moveTab(b.ptyId, pane0Id) // b back to pane0; pane1 empties → removed
    expect(p.panes).toHaveLength(1)
    expect(p.panes[0].tabs.map((t) => t.ptyId)).toEqual([a.ptyId, b.ptyId])
    expect(p.panes[0].activeTabId).toBe(b.ptyId)
  })

  it('moveTab honors an explicit insertion index within a pane', () => {
    const p = usePanes()
    const a = p.addTab(composer)
    const b = p.addTab(composer)
    const c = p.addTab(composer)
    // reorder c to the front of the same pane
    p.moveTab(c.ptyId, p.panes[0].id, 0)
    expect(p.panes[0].tabs.map((t) => t.ptyId)).toEqual([c.ptyId, a.ptyId, b.ptyId])
  })

  it('moveActiveToAdjacentPane moves to an existing neighbor', () => {
    const p = usePanes()
    const a = p.addTab(composer)
    const b = p.addTab(composer)
    p.moveToNewPane(b.ptyId, 'right') // pane0=[a] focused? no — focus moved to pane1
    p.focusTab(p.panes[0].id, a.ptyId) // focus pane0
    p.moveActiveToAdjacentPane(1) // a → pane1
    expect(p.panes).toHaveLength(1) // pane0 emptied and removed
    expect(p.panes[0].tabs.map((t) => t.ptyId)).toEqual([b.ptyId, a.ptyId])
  })

  it('moveActiveToAdjacentPane past the edge spills into a new edge pane', () => {
    const p = usePanes()
    const a = p.addTab(composer)
    const b = p.addTab(composer) // both in pane0, b active
    p.moveActiveToAdjacentPane(1) // b past the right edge → new pane
    expect(p.panes).toHaveLength(2)
    expect(p.panes[0].tabs.map((t) => t.ptyId)).toEqual([a.ptyId])
    expect(p.panes[1].tabs.map((t) => t.ptyId)).toEqual([b.ptyId])
  })
})

describe('usePanes resize', () => {
  it('shifts width between a pane and its right neighbor', () => {
    const p = usePanes()
    p.addTab(composer)
    const b = p.addTab(composer)
    p.moveToNewPane(b.ptyId, 'right') // 0.5 / 0.5
    p.resizePane(p.panes[0].id, 0.1, 0.2)
    expect(p.panes[0].widthFraction).toBeCloseTo(0.6)
    expect(p.panes[1].widthFraction).toBeCloseTo(0.4)
    expect(sumFractions(p.panes)).toBeCloseTo(1)
  })

  it('clamps so neither neighbor drops below minFraction', () => {
    const p = usePanes()
    p.addTab(composer)
    const b = p.addTab(composer)
    p.moveToNewPane(b.ptyId, 'right') // 0.5 / 0.5
    p.resizePane(p.panes[0].id, 0.9, 0.2) // would push right below the min
    expect(p.panes[0].widthFraction).toBeCloseTo(0.8)
    expect(p.panes[1].widthFraction).toBeCloseTo(0.2)
  })

  it('is a no-op on the rightmost pane (no neighbor to borrow from)', () => {
    const p = usePanes()
    p.addTab(composer)
    const b = p.addTab(composer)
    p.moveToNewPane(b.ptyId, 'right')
    const before = p.panes.map((pane) => pane.widthFraction)
    p.resizePane(p.panes[1].id, 0.1, 0.2)
    expect(p.panes.map((pane) => pane.widthFraction)).toEqual(before)
  })
})

describe('usePanes helpers', () => {
  it('markExited flags the tab', () => {
    const p = usePanes()
    const a = p.addTab(composer)
    p.markExited(a.ptyId)
    expect(p.find(a.ptyId)?.tab.exited).toBe(true)
  })

  it('isActiveInFocusedPane reflects focus + active tab', () => {
    const p = usePanes()
    const a = p.addTab(composer)
    const b = p.addTab(composer)
    p.moveToNewPane(b.ptyId, 'right') // focus → pane1, b active
    expect(p.isActiveInFocusedPane(b.ptyId)).toBe(true)
    expect(p.isActiveInFocusedPane(a.ptyId)).toBe(false)
    p.focusTab(p.panes[0].id, a.ptyId)
    expect(p.isActiveInFocusedPane(a.ptyId)).toBe(true)
    expect(p.isActiveInFocusedPane(b.ptyId)).toBe(false)
  })
})
