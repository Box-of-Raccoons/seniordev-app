import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers = new Map<string, (...a: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => handlers.set(ch, fn) }
}))

import { registerSidebarIpc } from './sidebar-handlers'
import type { SessionPersistence } from '../session-persistence'
import type { WorkspaceStore } from '../store/workspace-store'

beforeEach(() => handlers.clear())

// Minimal fakes: the handlers are thin pass-throughs, so only the methods they
// touch need to exist. Casts keep the fakes to the surface actually exercised.
function setup(over?: {
  setArchived?: (id: string, a: boolean) => void
  sidebar?: { sidebarWidth: number | null; sidebarCollapsed: boolean }
  isResumable?: (c: { tool: string; agentSessionId: string | null }) => boolean
}) {
  const projectList = [{ id: 'p1', title: 'app', archivedAt: null }]
  const convList = [
    { id: 'c1', projectId: 'p1', tool: 'claude', agentSessionId: 'c1' },
    { id: 'c2', projectId: 'p1', tool: 'claude', agentSessionId: null }
  ]
  const setArchived = vi.fn(over?.setArchived)
  const ensureForCwd = vi.fn((path: string, opts?: { defaultTool?: string }) => ({
    id: 'p-new',
    title: path.split('/').pop(),
    path,
    defaultTool: opts?.defaultTool ?? 'claude'
  }))
  const setConvArchived = vi.fn()
  const persistence = {
    projects: { list: () => projectList, setArchived, ensureForCwd },
    conversations: { list: () => convList, setArchived: setConvArchived }
  } as unknown as SessionPersistence
  const workspace = {
    get: () => ({ sidebarWidth: over?.sidebar?.sidebarWidth ?? 240, sidebarCollapsed: over?.sidebar?.sidebarCollapsed ?? false })
  } as unknown as WorkspaceStore
  const send = vi.fn()
  const getSender = (): { send: typeof send } => ({ send })
  // Default the resumable check to "id present" so the handler test is deterministic
  // and does not touch the real filesystem.
  const isResumable = over?.isResumable ?? ((c: { agentSessionId: string | null }): boolean => c.agentSessionId !== null)
  const source = { config: { defaultTool: 'codex' } } as never
  registerSidebarIpc({ persistence, workspace, getSender: getSender as never, isResumable, source })
  return { projectList, convList, setArchived, ensureForCwd, setConvArchived, send }
}

describe('registerSidebarIpc', () => {
  it('projects:list returns the store list', async () => {
    const { projectList } = setup()
    expect(await handlers.get('projects:list')!({})).toBe(projectList)
  })

  it('conversations:list enriches each conversation with a computed resumable flag', async () => {
    setup()
    const out = (await handlers.get('conversations:list')!({})) as Array<{ id: string; resumable: boolean }>
    expect(out.map((c) => ({ id: c.id, resumable: c.resumable }))).toEqual([
      { id: 'c1', resumable: true },
      { id: 'c2', resumable: false }
    ])
  })

  it('conversations:list resumable is driven by the injected check, not agentSessionId alone', async () => {
    // Model the bug: an id is present but the agent has no transcript → not resumable.
    setup({ isResumable: () => false })
    const out = (await handlers.get('conversations:list')!({})) as Array<{ resumable: boolean }>
    expect(out.every((c) => c.resumable === false)).toBe(true)
  })

  it('projects:setArchived mutates the store and nudges the sidebar', async () => {
    const { setArchived, send } = setup()
    await handlers.get('projects:setArchived')!({}, 'p1', false)
    expect(setArchived).toHaveBeenCalledWith('p1', false)
    expect(send).toHaveBeenCalledWith('sidebar:changed')
  })

  it('workspace:getSidebar reads the persisted geometry', async () => {
    setup({ sidebar: { sidebarWidth: 300, sidebarCollapsed: true } })
    expect(await handlers.get('workspace:getSidebar')!({})).toEqual({ width: 300, collapsed: true })
  })

  it('projects:ensure creates/refreshes from a folder using the config default tool, returns the row, and nudges', async () => {
    const { ensureForCwd, send } = setup()
    const row = await handlers.get('projects:ensure')!({}, '/Users/h/code/newapp')
    expect(ensureForCwd).toHaveBeenCalledWith('/Users/h/code/newapp', { defaultTool: 'codex' })
    expect(row).toMatchObject({ id: 'p-new', path: '/Users/h/code/newapp' })
    expect(send).toHaveBeenCalledWith('sidebar:changed')
  })

  it('conversations:setArchived toggles the conversation and nudges the sidebar', async () => {
    const { setConvArchived, send } = setup()
    await handlers.get('conversations:setArchived')!({}, 'c9', false)
    expect(setConvArchived).toHaveBeenCalledWith('c9', false)
    expect(send).toHaveBeenCalledWith('sidebar:changed')
  })
})
