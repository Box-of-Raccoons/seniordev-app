import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import Sidebar from './Sidebar.vue'
import { useWorkspace, type UseWorkspace } from '../composables/useWorkspace'
import type { ProjectInfo, ConversationInfo, Schedule, ConversationCostInfo } from '../../../shared/ipc'
import type { UseScheduleBadges } from '../composables/useScheduleBadges'
import { ref } from 'vue'

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
// Supervision slice 3a. Module-level so a test can set costs without threading a
// fifth positional arg through every existing setApi call site.
let stubCosts: ConversationCostInfo[] = []
function setApi(
  projects: ProjectInfo[],
  conversations: ConversationInfo[],
  teardownResult: { archived: boolean; worktree?: { ok: boolean; error?: string } } = { archived: true },
  suppressTeardownConfirm = false
): {
  setProjectArchived: ReturnType<typeof vi.fn>
  teardownConversation: ReturnType<typeof vi.fn>
  ensureProject: ReturnType<typeof vi.fn>
  setConversationArchived: ReturnType<typeof vi.fn>
  pickFolder: ReturnType<typeof vi.fn>
  setSuppressTeardownConfirm: ReturnType<typeof vi.fn>
} {
  const setProjectArchived = vi.fn(async () => {})
  const teardownConversation = vi.fn(async () => teardownResult)
  const ensureProject = vi.fn(async (folder: string) => ({
    id: 'p-new', title: folder.split('/').pop(), path: folder, defaultTool: 'claude',
    worktreeDefault: false, lastActiveAt: 0, archivedAt: null, createdAt: 0, updatedAt: 0
  }))
  const setConversationArchived = vi.fn(async () => {})
  const pickFolder = vi.fn(async () => '/code/newproj')
  const setSuppressTeardownConfirm = vi.fn(async () => {})
  ;(window as unknown as { api: unknown }).api = {
    listProjects: vi.fn(async () => projects),
    listConversations: vi.fn(async () => conversations),
    // Supervision slice 3a: the sidebar fetches notional costs on refresh.
    listCosts: vi.fn(async () => stubCosts),
    onSidebarChanged: vi.fn((cb: () => void) => { changedCb = cb; return () => {} }),
    listShells: vi.fn(async () => ({ shells: ['pwsh', 'bash'], default: 'pwsh' })),
    listTools: vi.fn(async () => ['claude', 'codex']),
    getSidebarState: vi.fn(async () => ({ width: null, collapsed: false, suppressTeardownConfirm })),
    setSuppressTeardownConfirm,
    setProjectArchived,
    teardownConversation,
    ensureProject,
    setConversationArchived,
    pickFolder
  }
  return { setProjectArchived, teardownConversation, ensureProject, setConversationArchived, pickFolder, setSuppressTeardownConfirm }
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
    <button class="pick-open-codex" @click="$emit('pick', { variant: 'agent', mode: 'open', tool: 'codex' })">open-codex</button>
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
  stubCosts = []
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

  it('a non-resumable dead conversation is hidden (nothing to focus or resume)', async () => {
    const ws = useWorkspace()
    setApi([project({})], [conv({ id: 'c-null', agentSessionId: null, resumable: false })])
    const w = await mountSidebar(ws)
    // A closed, non-resumable conversation is filtered out of the list entirely —
    // there is nothing the user can do with it, so it is no longer shown as an
    // inert row.
    expect(w.find('.conv').exists()).toBe(false)
  })

  it('an id-present-but-not-resumable conversation is hidden (the empty-session bug)', async () => {
    // agentSessionId is set (claude pre-assigns at spawn) but the main-side check
    // found no transcript, so resumable is false. Previously shown as an inert
    // "no resume" row; now hidden entirely — a doomed resume was never offered,
    // and now neither is a dead row.
    const ws = useWorkspace()
    setApi([project({})], [conv({ id: 'c-empty', agentSessionId: 'has-id', resumable: false })])
    const w = await mountSidebar(ws)
    expect(w.find('.conv').exists()).toBe(false)
  })

  it('an OPEN non-resumable conversation is still shown (never hide a live session)', async () => {
    // Safety property of the hide-dead filter: a freshly launched session is open
    // (a live tab) but has not yet written a resumable transcript. It must not
    // vanish from under the user just because resumable is still false.
    const ws = useWorkspace()
    ws.panes.addTab({ title: 'live', kind: 'terminal', variant: 'agent', conversationId: 'c-live' })
    setApi([project({})], [conv({ id: 'c-live', agentSessionId: 'has-id', resumable: false })])
    const w = await mountSidebar(ws)
    expect(w.find('.conv').exists()).toBe(true)
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

  it('S7: with suppress set, a no-worktree archive skips the dialog and archives immediately', async () => {
    const { teardownConversation } = setApi(
      [project({ id: 'p1' })],
      [conv({ id: 'c1', title: 'work', worktreePath: null })],
      { archived: true },
      true // suppressTeardownConfirm
    )
    const w = await mountSidebar(useWorkspace())
    await w.find('.conv-x').trigger('click')
    await flushPromises()
    expect(w.findComponent({ name: 'WorktreeTeardownDialog' }).exists()).toBe(false) // no dialog
    expect(teardownConversation).toHaveBeenCalledWith({ conversationId: 'c1', removeWorktree: false })
  })

  it('S7: with suppress set, a conversation WITH a worktree still shows the dialog', async () => {
    setApi(
      [project({ id: 'p1' })],
      [conv({ id: 'c1', title: 'wt', worktreePath: '/wt/x' })],
      { archived: true },
      true
    )
    const w = await mountSidebar(useWorkspace())
    await w.find('.conv-x').trigger('click')
    expect(w.findComponent({ name: 'WorktreeTeardownDialog' }).exists()).toBe(true)
  })

  it('S7: checking "Don\'t ask again" in the dialog persists the preference', async () => {
    const { setSuppressTeardownConfirm } = setApi([project({ id: 'p1' })], [conv({ id: 'c1', worktreePath: null })])
    const w = await mountSidebar(useWorkspace())
    await w.find('.conv-x').trigger('click') // no suppress yet → dialog shows
    await w.find('.dont-ask input').setValue(true)
    await w.find('.btn-yes').trigger('click')
    await flushPromises()
    expect(setSuppressTeardownConfirm).toHaveBeenCalledWith(true)
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

  it('project + New Session with a chosen agent spawns that agent (not the project default)', async () => {
    setApi([project({ id: 'p1', title: 'app', path: '/app', defaultTool: 'claude' })], [])
    const ws = useWorkspace()
    const w = await mountSidebar(ws)
    await w.find('.pick-open-codex').trigger('click')
    const tab = ws.panes.panes[0].tabs[0]
    expect(tab).toMatchObject({ kind: 'terminal', variant: 'agent', tool: 'codex', cwdOverride: '/app' })
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

// Schedule badge (added with the scheduled-prompts feature). A hand-built stand-in
// for the composable, so the render is asserted against a known answer rather than
// against a second moving part.
function badgesFor(found: Schedule | null): UseScheduleBadges {
  return {
    schedules: ref<Schedule[]>(found ? [found] : []),
    now: ref(Date.now()),
    start: () => {},
    stop: () => {},
    soonestFor: (id) => (found && id === 'c1' ? found : null)
  }
}

function schedule(over: Partial<Schedule> = {}): Schedule {
  return {
    id: 's1', enabled: true, title: 'nightly sweep',
    target: { kind: 'conversation', conversationId: 'c1' },
    prompt: 'go', trigger: { kind: 'daily', hour: 5, minute: 0 },
    catchUp: false, maxFirings: 10, stopOnFailure: true,
    firedCount: 0, nextDueAt: Date.now() + 4 * 3600_000,
    lastFiredAt: null, lastOutcome: null, lastReason: null, deferredSinceAt: null, createdAt: 0,
    ...over
  }
}

describe('Sidebar schedule badge', () => {
  async function mountWithBadges(b?: UseScheduleBadges) {
    setApi([project({})], [conv({ id: 'c1', title: 'GG-14 login fix' })])
    const w = mount(Sidebar, { props: { ws: useWorkspace(), scheduleBadges: b }, global: { stubs } })
    await flushPromises()
    return w
  }

  it('marks a conversation that has something queued to type into it', async () => {
    // Proving the composable resolves a schedule is not the same as proving the
    // ROW says so, which is the whole point of the affordance.
    const w = await mountWithBadges(badgesFor(schedule()))
    const tag = w.find('.tag--sched')
    expect(tag.exists()).toBe(true)
    // The word carries the state; colour is emphasis, never the signal itself.
    expect(tag.text()).toBe('scheduled')
    expect(tag.attributes('title')).toContain('nightly sweep')
    expect(tag.attributes('title')).toContain('next')
  })

  it('leaves an unscheduled conversation unmarked', async () => {
    const w = await mountWithBadges(badgesFor(null))
    expect(w.find('.tag--sched').exists()).toBe(false)
  })

  it('renders normally when no badges are supplied at all', async () => {
    // The prop is optional: the sidebar must not depend on scheduling existing.
    const w = await mountWithBadges(undefined)
    expect(w.text()).toContain('GG-14 login fix')
    expect(w.find('.tag--sched').exists()).toBe(false)
  })
})

// Supervision slice 3a. A quiet figure on the row, never a metric tile, and
// never presented as a bill — work here runs on a subscription.
describe('Sidebar — notional cost', () => {
  const costInfo = (over: Partial<ConversationCostInfo> = {}): ConversationCostInfo => ({
    conversationId: 'c1',
    mainTokens: 1_000_000,
    mainCost: 5,
    sidechainTokens: 0,
    sidechainCost: 0,
    unpricedModels: [],
    messages: 12,
    models: ['claude-opus-5'],
    ...over
  })

  async function mountWithCost(costs: ConversationCostInfo[]) {
    stubCosts = costs
    setApi([project({ id: 'p1' })], [conv({ id: 'c1', projectId: 'p1' })])
    const w = mount(Sidebar, { props: { ws: useWorkspace() as UseWorkspace } })
    await flushPromises()
    return w
  }

  it('shows no figure for a session with no recorded usage', async () => {
    const w = await mountWithCost([])
    expect(w.find('.cost').exists()).toBe(false)
  })

  it('shows tokens and cost on the row', async () => {
    const w = await mountWithCost([costInfo()])
    expect(w.find('.cost').text()).toBe('1.0M · $5.00')
  })

  it('says in the tooltip that the figure is NOT a bill', async () => {
    const w = await mountWithCost([costInfo()])
    expect(w.find('.cost').attributes('title')).toMatch(/not a bill/i)
  })

  it('breaks out subagent spend in the tooltip', async () => {
    const w = await mountWithCost([costInfo({ sidechainTokens: 2_000_000, sidechainCost: 3 })])
    expect(w.find('.cost').attributes('title')).toMatch(/subagents: 2\.0M tokens/)
  })

  it('falls back to tokens alone when a model has no known price', async () => {
    const w = await mountWithCost([costInfo({ mainCost: null, unpricedModels: ['brand-new'] })])
    expect(w.find('.cost').text()).toBe('1.0M')
    expect(w.find('.cost').attributes('title')).toMatch(/no known price for brand-new/)
  })

  it('survives a cost fetch that fails, without blanking the sidebar', async () => {
    setApi([project({ id: 'p1' })], [conv({ id: 'c1', projectId: 'p1' })])
    ;(window as unknown as { api: { listCosts: unknown } }).api.listCosts = vi.fn(async () => {
      throw new Error('transcript read exploded')
    })
    const w = mount(Sidebar, { props: { ws: useWorkspace() as UseWorkspace } })
    await flushPromises()
    // The project list is the load-bearing content; pricing must not take it down.
    expect(w.findAll('.conv').length).toBe(1)
    expect(w.find('.cost').exists()).toBe(false)
  })
})
