import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspaceStore } from './workspace-store'

describe('workspace store', () => {
  let dir: string
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips window bounds', () => {
    dir = mkdtempSync(join(tmpdir(), 'ws-'))
    const file = join(dir, 'workspace.json')
    const s = createWorkspaceStore({ file })
    expect(s.getWindowBounds()).toBeNull()
    s.setWindowBounds({ x: 10, y: 20, width: 1400, height: 900 })
    s.flush()
    const s2 = createWorkspaceStore({ file })
    expect(s2.getWindowBounds()).toEqual({ x: 10, y: 20, width: 1400, height: 900 })
  })

  it('persists a pane/tab layout (tabs as conversationIds)', () => {
    dir = mkdtempSync(join(tmpdir(), 'ws-'))
    const file = join(dir, 'workspace.json')
    const s = createWorkspaceStore({ file })
    s.setLayout({
      panes: [
        { id: 'p1', widthFraction: 0.6, tabs: ['conv-a', 'conv-b'], activeTabId: 'conv-a' },
        { id: 'p2', widthFraction: 0.4, tabs: ['conv-c'], activeTabId: 'conv-c' }
      ],
      sidebarWidth: 260,
      sidebarCollapsed: false
    })
    s.flush()
    const doc = JSON.parse(readFileSync(file, 'utf8'))
    expect(doc.panes).toHaveLength(2)
    expect(doc.panes[0].tabs).toEqual(['conv-a', 'conv-b'])
    expect(doc.sidebarWidth).toBe(260)
  })

  it('ignores malformed bounds and drops non-string tabs on migrate', () => {
    dir = mkdtempSync(join(tmpdir(), 'ws-'))
    const file = join(dir, 'workspace.json')
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        windowBounds: { width: 'nope' },
        panes: [{ id: 'p1', widthFraction: 0.5, tabs: ['ok', 7, null], activeTabId: 'ok' }]
      }),
      'utf8'
    )
    const s = createWorkspaceStore({ file })
    expect(s.getWindowBounds()).toBeNull()
    expect(s.get().panes[0].tabs).toEqual(['ok'])
  })

  it('recovers to defaults from a corrupt file', () => {
    dir = mkdtempSync(join(tmpdir(), 'ws-'))
    const file = join(dir, 'workspace.json')
    writeFileSync(file, '{bad', 'utf8')
    const s = createWorkspaceStore({ file })
    expect(s.get()).toEqual({
      version: 1,
      windowBounds: null,
      sidebarWidth: null,
      sidebarCollapsed: false,
      panes: [],
      suppressTeardownConfirm: false,
      subagentPanel: { placement: 'right', collapsed: false, size: 300, appOnly: false }
    })
  })

  it('S7: persists suppressTeardownConfirm (default false)', () => {
    dir = mkdtempSync(join(tmpdir(), 'ws-'))
    const file = join(dir, 'workspace.json')
    const s = createWorkspaceStore({ file })
    expect(s.get().suppressTeardownConfirm).toBe(false)
    s.setSuppressTeardownConfirm(true)
    expect(s.get().suppressTeardownConfirm).toBe(true)
    // Survives a reload.
    s.flush()
    expect(createWorkspaceStore({ file }).get().suppressTeardownConfirm).toBe(true)
  })

  it('S8: persists the subagent panel state via setLayout and survives reload', () => {
    dir = mkdtempSync(join(tmpdir(), 'ws-'))
    const file = join(dir, 'workspace.json')
    const s = createWorkspaceStore({ file })
    // Default when nothing was ever set.
    expect(s.get().subagentPanel).toEqual({ placement: 'right', collapsed: false, size: 300, appOnly: false })
    s.setLayout({
      panes: [],
      sidebarWidth: null,
      sidebarCollapsed: false,
      subagentPanel: { placement: 'bottom', collapsed: true, size: 220, appOnly: true }
    })
    s.flush()
    expect(createWorkspaceStore({ file }).get().subagentPanel).toEqual({
      placement: 'bottom',
      collapsed: true,
      size: 220,
      appOnly: true
    })
  })

  it('S8: coerces a partial/corrupt subagent panel blob to defaults per field', () => {
    dir = mkdtempSync(join(tmpdir(), 'ws-'))
    const file = join(dir, 'workspace.json')
    // A pre-S8 doc with a bogus/partial subagentPanel: only collapsed set, junk size.
    writeFileSync(file, JSON.stringify({ version: 1, subagentPanel: { collapsed: true, size: -5, placement: 'sideways' } }), 'utf8')
    expect(createWorkspaceStore({ file }).get().subagentPanel).toEqual({
      placement: 'right', // invalid → default
      collapsed: true, // preserved
      size: 300, // non-positive → default
      appOnly: false // missing → default
    })
  })

  it('debounces persistence across a burst of updates', () => {
    vi.useFakeTimers()
    dir = mkdtempSync(join(tmpdir(), 'ws-'))
    const file = join(dir, 'workspace.json')
    const s = createWorkspaceStore({ file })
    s.setWindowBounds({ width: 100, height: 100 })
    s.setLayout({ panes: [], sidebarWidth: null, sidebarCollapsed: false })
    expect(existsSync(file)).toBe(false) // still within the debounce window
    vi.advanceTimersByTime(500)
    expect(existsSync(file)).toBe(true)
    vi.useRealTimers()
  })
})
