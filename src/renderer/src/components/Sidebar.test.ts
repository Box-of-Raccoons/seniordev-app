import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import Sidebar from './Sidebar.vue'
import { useWorkspace, type UseWorkspace } from '../composables/useWorkspace'
import type { ProjectInfo, ConversationInfo } from '../../../shared/ipc'

function project(over: Partial<ProjectInfo>): ProjectInfo {
  return {
    id: 'p1', title: 'app', path: '/app', defaultTool: 'claude', worktreeDefault: false,
    lastActiveAt: 0, archivedAt: null, createdAt: 0, updatedAt: 0, ...over
  }
}
function conv(over: Partial<ConversationInfo>): ConversationInfo {
  return {
    id: 'c', projectId: 'p1', title: 't', tool: 'claude', agentSessionId: 'sid', resumable: true,
    cwd: '/app', worktreePath: null, branch: null, lastActiveAt: 0, createdAt: 0, archivedAt: null, ...over
  }
}

let changedCb: (() => void) | null = null
function setApi(
  projects: ProjectInfo[],
  conversations: ConversationInfo[],
  teardownResult: { archived: boolean; worktree?: { ok: boolean; error?: string } } = { archived: true }
): {
  setProjectArchived: ReturnType<typeof vi.fn>
  teardownConversation: ReturnType<typeof vi.fn>
  ensureProject: ReturnType<typeof vi.fn>
  setConversationArchived: ReturnType<typeof vi.fn>
  pickFolder: ReturnType<typeof vi.fn>
} {
  const setProjectArchived = vi.fn(async () => {})
  const teardownConversation = vi.fn(async () => teardownResult)
  const ensureProject = vi.fn(async (folder: string) => ({
    id: 'p-new', title: folder.split('/').pop(), path: folder, defaultTool: 'claude',
    worktreeDefault: false, lastActiveAt: 0, archivedAt: null, createdAt: 0, updatedAt: 0
  }))
  const setConversationArchived = vi.fn(async () => {})
  const pickFolder = vi.fn(async () => '/code/newproj')
  ;(window as unknown as { api: unknown }).api = {
    listProjects: vi.fn(async () => projects),
    listConversations: vi.fn(async () => conversations),
    onSidebarChanged: vi.fn((cb: () => void) => { changedCb = cb; return () => {} }),
    listShells: vi.fn(async () => ({ shells: ['pwsh', 'bash'], default: 'pwsh' })),
    setProjectArchived,
    teardownConversation,
    ensureProject,
    setConversationArchived,
    pickFolder
  }
  return { setProjectArchived, teardownConversation, ensureProject, setConversationArchived, pickFolder }
}

// Stub NewTabMenu with buttons that emit each pick variant, plus an openMenu expose
// so New Project's ref call is a no-op-safe hook.
const NewTabMenuStub = {
  name: 'NewTabMenu',
  props: ['ghost', 'label'],
  emits: ['pick'],
  setup(_p: unknown, { expose }: { expose: (o: object) => void }) {
    expose({ openMenu: (): void => {} })
    return {}
  },
  template: `<div class="ntm">
    <button class="pick-ai" @click="$emit('pick', { variant: 'agent' })">ai</button>
    <button class="pick-open" @click="$emit('pick', { variant: 'agent', mode: 'open' })">open</button>
    <button class="pick-term" @click="$emit('pick', { variant: 'terminal' })">term</button>
  </div>`
}
const stubs = {
  StatusGlyph: { props: ['status'], template: '<span class="glyph" :data-status="status" />' },
  NewTabMenu: NewTabMenuStub
}

async function mountSidebar(ws: UseWorkspace) {
  const w = mount(Sidebar, { props: { ws }, global: { stubs } })
  await flushPromises()
  return w
}

beforeEach(() => {
  changedCb = null
})

describe('Sidebar', () => {
  it('renders active projects with their conversations, newest first', async () => {
    setApi(
      [project({ id: 'p1', title: 'app' })],
      [conv({ id: 'c1', title: 'older', lastActiveAt: 10 }), conv({ id: 'c2', title: 'newer', lastActiveAt: 20 })]
    )
    const w = await mountSidebar(useWorkspace())
    const labels = w.findAll('.conv .label').map((n) => n.text())
    expect(labels).toEqual(['newer', 'older'])
  })

  it('labels each row with its agent tool (claude vs codex)', async () => {
    setApi(
      [project({ id: 'p1' })],
      [conv({ id: 'c1', title: 'a', tool: 'claude', lastActiveAt: 20 }), conv({ id: 'c2', title: 'b', tool: 'codex', lastActiveAt: 10 })]
    )
    const w = await mountSidebar(useWorkspace())
    expect(w.findAll('.conv .tool').map((n) => n.text())).toEqual(['claude', 'codex'])
  })

  it('clicking a resumable dead conversation resumes it into the leftmost pane with its own id', async () => {
    setApi([project({})], [conv({ id: 'conv-x', agentSessionId: 'sess-x', cwd: '/app', tool: 'claude' })])
    const ws = useWorkspace()
    const w = await mountSidebar(ws)
    await w.find('.conv').trigger('click')
    const leftmost = ws.panes.panes[0]
    const spawned = leftmost.tabs.find((t) => t.conversationId === 'conv-x')
    expect(spawned).toBeTruthy()
    // Reuses the record id (no duplicate row) and carries the resume session id.
    expect(spawned!.resume).toEqual({ sessionId: 'sess-x' })
    expect(spawned!.cwdOverride).toBe('/app')
    expect(spawned!.kind).toBe('terminal')
  })

  it('clicking an open conversation focuses its live tab instead of resuming', async () => {
    const ws = useWorkspace()
    // Pre-open a live tab for the conversation, so its row renders as open.
    const live = ws.panes.addTab({ title: 'live', kind: 'terminal', variant: 'agent', conversationId: 'conv-open' })
    setApi([project({})], [conv({ id: 'conv-open', agentSessionId: 'sess' })])
    const w = await mountSidebar(ws)
    const focusSpy = vi.spyOn(ws.panes, 'focusTab')
    const before = ws.panes.panes[0].tabs.length
    await w.find('.conv').trigger('click')
    expect(focusSpy).toHaveBeenCalledWith(ws.panes.panes[0].id, live.ptyId)
    expect(ws.panes.panes[0].tabs).toHaveLength(before) // focused, not spawned
  })

  it('a non-resumable dead conversation is inert (disabled, no spawn on click)', async () => {
    const ws = useWorkspace()
    setApi([project({})], [conv({ id: 'c-null', agentSessionId: null, resumable: false })])
    const w = await mountSidebar(ws)
    const row = w.find('.conv')
    expect(row.attributes('disabled')).toBeDefined()
    expect(w.find('.conv .tag').text()).toBe('no resume')
    await row.trigger('click')
    expect(ws.panes.panes[0].tabs).toHaveLength(0) // nothing spawned
  })

  it('an id-present-but-not-resumable conversation is inert (the empty-session bug)', async () => {
    // The regression: agentSessionId is set (claude pre-assigns at spawn) but the
    // main-side check found no transcript, so resumable is false. The row must be
    // inert and must not spawn a doomed resume.
    const ws = useWorkspace()
    setApi([project({})], [conv({ id: 'c-empty', agentSessionId: 'has-id', resumable: false })])
    const w = await mountSidebar(ws)
    const row = w.find('.conv')
    expect(row.attributes('disabled')).toBeDefined()
    expect(w.find('.conv .tag').text()).toBe('no resume')
    await row.trigger('click')
    expect(ws.panes.panes[0].tabs).toHaveLength(0) // no broken resume spawned
  })

  it('restores an archived project and re-fetches', async () => {
    const { setProjectArchived } = setApi(
      [project({ id: 'pa', title: 'gone', archivedAt: 5 })],
      []
    )
    const w = await mountSidebar(useWorkspace())
    await w.find('.arch-head').trigger('click') // expand Archived (n)
    await w.find('.restore').trigger('click')
    expect(setProjectArchived).toHaveBeenCalledWith('pa', false)
  })

  it('re-fetches when main signals a sidebar change', async () => {
    setApi([project({ id: 'p1', title: 'first' })], [])
    const w = await mountSidebar(useWorkspace())
    expect(w.text()).toContain('first')
    // Main renames/adds via a fresh dataset, then nudges.
    ;(window.api.listProjects as ReturnType<typeof vi.fn>).mockResolvedValue([project({ id: 'p2', title: 'second' })])
    changedCb?.()
    await flushPromises()
    expect(w.text()).toContain('second')
  })

  it('collapse and expand toggle the shared state and swap to the rail', async () => {
    setApi([project({})], [])
    const ws = useWorkspace()
    const w = await mountSidebar(ws)
    expect(w.find('.rail').exists()).toBe(false)
    await w.find('.sb-head .icon-btn').trigger('click') // collapse
    expect(ws.sidebarCollapsed.value).toBe(true)
    expect(w.find('.rail').exists()).toBe(true)
    await w.find('.rail .icon-btn').trigger('click') // expand
    expect(ws.sidebarCollapsed.value).toBe(false)
    expect(w.find('.sidebar').exists()).toBe(true)
  })

  it('keyboard resize nudges the width within bounds', async () => {
    setApi([project({})], [])
    const ws = useWorkspace()
    ws.sidebarWidth.value = 300
    const w = await mountSidebar(ws)
    await w.find('.sb-grip').trigger('keydown', { key: 'ArrowRight' })
    expect(ws.sidebarWidth.value).toBe(316)
    await w.find('.sb-grip').trigger('keydown', { key: 'ArrowLeft' })
    expect(ws.sidebarWidth.value).toBe(300)
    // Clamps at the max.
    ws.sidebarWidth.value = 480
    await w.find('.sb-grip').trigger('keydown', { key: 'ArrowRight' })
    expect(ws.sidebarWidth.value).toBe(480)
  })

  // Regression: App.vue sizes the sidebar by passing :style (flex: 0 0 <w>px) as a
  // fallthrough attr. That only lands on a SINGLE-root component — adding the
  // teardown dialog as an extra template root made Sidebar a fragment, so the flex
  // was dropped and the sidebar filled the row, hiding the work area.
  it('inherits a fallthrough style onto its root (single-root, not a fragment)', async () => {
    setApi([project({ id: 'p1' })], [])
    const w = mount(Sidebar, {
      props: { ws: useWorkspace() },
      attrs: { style: 'flex: 0 0 264px' },
      global: { stubs }
    })
    await flushPromises()
    expect(w.attributes('style')).toContain('flex: 0 0 264px')
  })

  // --- S5 teardown ---

  it('the teardown control opens the dialog and confirming archives via the IPC', async () => {
    const { teardownConversation } = setApi([project({ id: 'p1' })], [conv({ id: 'c1', title: 'work' })])
    const w = await mountSidebar(useWorkspace())
    expect(w.findComponent({ name: 'WorktreeTeardownDialog' }).exists()).toBe(false)
    await w.find('.conv-x').trigger('click')
    expect(w.findComponent({ name: 'WorktreeTeardownDialog' }).exists()).toBe(true)
    await w.find('.btn-yes').trigger('click') // "Archive"
    await flushPromises()
    expect(teardownConversation).toHaveBeenCalledWith({ conversationId: 'c1', removeWorktree: false })
    // Dialog closes on success.
    expect(w.findComponent({ name: 'WorktreeTeardownDialog' }).exists()).toBe(false)
  })

  it('offers worktree removal only when the conversation has a worktree, and passes the opt-in', async () => {
    const { teardownConversation } = setApi(
      [project({ id: 'p1' })],
      [conv({ id: 'c1', title: 'wt', worktreePath: '/cfg/worktrees/app/feat' })]
    )
    const w = await mountSidebar(useWorkspace())
    await w.find('.conv-x').trigger('click')
    const box = w.find('.wt-remove input')
    expect(box.exists()).toBe(true)
    await box.setValue(true)
    await w.find('.btn-yes').trigger('click')
    await flushPromises()
    expect(teardownConversation).toHaveBeenCalledWith({ conversationId: 'c1', removeWorktree: true })
  })

  it('reports a worktree-removal failure and keeps the dialog open', async () => {
    setApi(
      [project({ id: 'p1' })],
      [conv({ id: 'c1', worktreePath: '/wt/x' })],
      { archived: true, worktree: { ok: false, error: 'worktree has uncommitted changes; not removed' } }
    )
    const w = await mountSidebar(useWorkspace())
    await w.find('.conv-x').trigger('click')
    await w.find('.wt-remove input').setValue(true)
    await w.find('.btn-yes').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('worktree has uncommitted changes; not removed')
    expect(w.findComponent({ name: 'WorktreeTeardownDialog' }).exists()).toBe(true)
  })

  // --- S6 project-centric launch ---

  it('project + AI opens a folder-locked composer for that project in the leftmost pane', async () => {
    setApi([project({ id: 'p1', title: 'app', path: '/app', defaultTool: 'claude' })], [])
    const ws = useWorkspace()
    const w = await mountSidebar(ws)
    await w.find('.pick-ai').trigger('click')
    const tab = ws.panes.panes[0].tabs[0]
    expect(tab).toMatchObject({ kind: 'composer', variant: 'agent', lockedProject: 'app', tool: 'claude', prefill: { folder: '/app' } })
  })

  it('project + Open spawns a bare agent in the project (leftmost pane, no prompt)', async () => {
    setApi([project({ id: 'p1', title: 'app', path: '/app', defaultTool: 'codex' })], [])
    const ws = useWorkspace()
    const w = await mountSidebar(ws)
    await w.find('.pick-open').trigger('click')
    const tab = ws.panes.panes[0].tabs[0]
    expect(tab).toMatchObject({ kind: 'terminal', variant: 'agent', tool: 'codex', cwdOverride: '/app' })
    expect(tab.prompt).toBeUndefined()
  })

  it('project + Terminal spawns a shell in the project with the default shell', async () => {
    setApi([project({ id: 'p1', title: 'app', path: '/app' })], [])
    const ws = useWorkspace()
    const w = await mountSidebar(ws)
    await w.find('.pick-term').trigger('click')
    const tab = ws.panes.panes[0].tabs[0]
    expect(tab).toMatchObject({ kind: 'shell', shell: 'pwsh', cwdOverride: '/app' })
  })

  it('New Project picks a folder and ensures the project', async () => {
    const { pickFolder, ensureProject } = setApi([], [])
    const w = await mountSidebar(useWorkspace())
    await w.find('.new-project').trigger('click')
    await flushPromises()
    expect(pickFolder).toHaveBeenCalled()
    expect(ensureProject).toHaveBeenCalledWith('/code/newproj')
  })

  it('an archived conversation can be revealed and restored', async () => {
    const { setConversationArchived } = setApi(
      [project({ id: 'p1', title: 'app' })],
      [conv({ id: 'c-arch', projectId: 'p1', title: 'old work', archivedAt: 5 })]
    )
    const w = await mountSidebar(useWorkspace())
    // The archived conversation is hidden from the main list...
    expect(w.text()).not.toContain('old work')
    // ...until its Archived (n) reveal is expanded.
    await w.find('.arch-convs-head').trigger('click')
    expect(w.text()).toContain('old work')
    await w.find('.arch-conv-row .restore').trigger('click')
    expect(setConversationArchived).toHaveBeenCalledWith('c-arch', false)
  })
})
