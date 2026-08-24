import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import RightPanel from './RightPanel.vue'
import { useWorkspace, type UseWorkspace } from '../composables/useWorkspace'
import { useSubagents } from '../composables/useSubagents'
import type { NewTab } from '../composables/usePanes'
import type { StatusUpdateEvent, Schedule, ScheduledResume, ConversationInfo, GateRunningEvent, GateResultEvent } from '../../../shared/ipc'
import type { UseScheduleBadges } from '../composables/useScheduleBadges'
import { ref } from 'vue'

// Captured so tests can drive status updates as if from main.
let statusCb: ((e: StatusUpdateEvent) => void) | null = null
// Same, for the slice-2 gate pushes.
let gateRunningCb: ((e: GateRunningEvent) => void) | null = null
let gateResultCb: ((e: GateResultEvent) => void) | null = null

beforeEach(() => {
  statusCb = null
  gateRunningCb = null
  gateResultCb = null
  ;(window as unknown as { api: unknown }).api = {
    spawnTerminal: vi.fn(async () => ({ ok: true })),
    spawnShell: vi.fn(async () => ({ ok: true })),
    writeTerminal: vi.fn(), resizeTerminal: vi.fn(), killTerminal: vi.fn(),
    onTerminalData: vi.fn(() => () => {}), onTerminalExit: vi.fn(() => () => {}),
    onStatusUpdate: vi.fn((cb: (e: StatusUpdateEvent) => void) => { statusCb = cb; return () => {} }),
    openExternal: vi.fn(async () => ({ ok: true })),
    listPrompts: vi.fn(async () => []), listRepos: vi.fn(async () => []),
    listShells: vi.fn(async () => ({ shells: ['pwsh'], default: 'pwsh' })),
    listTools: vi.fn(async () => ['claude']),
    getWorkspaceSettings: vi.fn(async () => ({ minPaneWidth: 320 })),
    saveWorkspace: vi.fn(),
    resolveRepo: vi.fn(async () => null),
    recordRecentFolder: vi.fn(),
    listRecentFolders: vi.fn(async () => []),
    yoloCaps: vi.fn(async () => ({ available: true })),
    onConfigChanged: vi.fn(() => () => {}),
    getStartup: vi.fn(async () => ({ tickets: [] })),
    listConversations: vi.fn(async () => [] as ConversationInfo[]),
    scheduleResumeDropped: vi.fn(),
    // Supervision slice 2: RightPanel subscribes to gate pushes at setup, so the
    // stub must carry them or every mount throws.
    onGateRunning: vi.fn((cb: (e: GateRunningEvent) => void) => { gateRunningCb = cb; return () => {} }),
    onGateResult: vi.fn((cb: (e: GateResultEvent) => void) => { gateResultCb = cb; return () => {} }),
    gateOutput: vi.fn(async () => null),
    runGate: vi.fn(async () => undefined)
  }
})

const Composer = {
  name: 'Composer',
  props: ['variant', 'tool', 'projectName'],
  emits: ['launch'],
  template: `<div class="composer-stub" :data-variant="variant" :data-tool="tool" :data-project="projectName">
    <button class="go-int" @click="$emit('launch', { mode: 'interactive', folder: 'C:/x', role: 'orchestrator', input: 'ISC-835', ticketKey: 'ISC-835', yolo: false, tool: 'claude' })">i</button>
    <button class="go-yolo" @click="$emit('launch', { mode: 'interactive', folder: 'C:/x', role: 'fix-bug', input: 'do it', yolo: true, tool: 'claude' })">y</button>
    <button class="go-term" @click="$emit('launch', { mode: 'terminal', folder: 'C:/proj/api', shell: 'pwsh' })">t</button>
    <button class="go-wt" @click="$emit('launch', { mode: 'interactive', folder: 'C:/x', role: 'orchestrator', input: 'do', tool: 'claude', worktreePath: '/cfg/worktrees/x/feat', branch: 'feat', worktreeChoice: true })">w</button>
  </div>`
}
const stubs = {
  Composer,
  TerminalView: {
    props: ['id', 'ticketKey', 'input', 'prompt', 'tool', 'resume', 'cwdOverride', 'shell', 'worktreePath', 'branch', 'worktreeChoice'],
    template:
      '<div class="tv" :data-id="id" :data-tool="tool" :data-cwd="cwdOverride" :data-shell="shell" :data-input="input" :data-resume="resume && resume.sessionId" :data-worktree="worktreePath" :data-branch="branch" />'
  },
  YoloView: {
    props: ['id', 'ticketKey', 'input', 'prompt', 'tool'],
    emits: ['exited', 'resume'],
    template:
      '<div class="yv" :data-id="id" :data-input="input"><button class="trigger-resume" @click="$emit(\'resume\', { sessionId: \'sid\', cwd: \'C:/x\', tool: \'claude\' })">resume</button></div>'
  }
}

// A3: RightPanel now reads the shared workspace state from a `ws` prop. The
// factory is plain (no lifecycle hooks), so a fresh one per mount is fine and
// gives each test an isolated pane/status model, exactly as before the lift.
function mountRP() {
  return mount(RightPanel, { props: { ws: useWorkspace(), subagents: useSubagents() }, global: { stubs } })
}

// S6 removed the per-pane + menu; the sidebar now seeds sessions via ws.panes.
// These helpers do the same through the component's own ws prop, so the existing
// cases keep exercising the real add-tab path without a menu to click.
async function seedAgent(w: ReturnType<typeof mountRP>): Promise<void> {
  const spec: NewTab = { title: 'New session', kind: 'composer', variant: 'agent' }
  ;(w.props('ws') as UseWorkspace).panes.addTab(spec)
  await w.vm.$nextTick()
}
async function seedTerm(w: ReturnType<typeof mountRP>): Promise<void> {
  const spec: NewTab = { title: 'New shell', kind: 'composer', variant: 'terminal' }
  ;(w.props('ws') as UseWorkspace).panes.addTab(spec)
  await w.vm.$nextTick()
}

describe('RightPanel', () => {
  it('starts with no tabs and a mascot empty state', () => {
    const w = mountRP()
    expect(w.findAll('.term-tab')).toHaveLength(0)
    expect(w.find('img.empty-state__art').exists()).toBe(true)
  })

  it('renders a single pane with no splitter until a second pane exists', async () => {
    const w = mountRP()
    await seedAgent(w)
    expect(w.findAll('.pane')).toHaveLength(1)
    expect(w.findAll('.pane-splitter')).toHaveLength(0)
  })

  it('dragging a tab to the right edge spins off a second pane with a splitter', async () => {
    const w = mountRP()
    await seedAgent(w)
    await seedAgent(w) // two tabs, one pane
    const tabs = w.findAll('.term-tab')
    await tabs[1].trigger('dragstart') // sets draggingPtyId → edge zones activate
    await w.find('.pane-edge--right').trigger('drop')
    await w.vm.$nextTick()
    expect(w.findAll('.pane')).toHaveLength(2)
    expect(w.findAll('.pane-splitter')).toHaveLength(1)
    // One tab landed in each pane.
    const panes = w.findAll('.pane')
    expect(panes[0].findAll('.term-tab')).toHaveLength(1)
    expect(panes[1].findAll('.term-tab')).toHaveLength(1)
  })

  it('dropping a tab on another pane strip moves it and collapses the emptied pane', async () => {
    const w = mountRP()
    await seedAgent(w)
    await seedAgent(w)
    await w.findAll('.term-tab')[1].trigger('dragstart')
    await w.find('.pane-edge--right').trigger('drop') // now two panes, one tab each
    await w.vm.$nextTick()
    // Drag the lone tab of pane 2 onto pane 1's strip.
    const pane2Tab = w.findAll('.pane')[1].find('.term-tab')
    await pane2Tab.trigger('dragstart')
    await w.findAll('.pane')[0].find('.term-tabs').trigger('drop')
    await w.vm.$nextTick()
    expect(w.findAll('.pane')).toHaveLength(1) // emptied pane removed
    expect(w.findAll('.pane-splitter')).toHaveLength(0)
    expect(w.findAll('.term-tab')).toHaveLength(2)
  })

  it('renders an agent composer for an agent composer tab', async () => {
    const w = mountRP()
    await seedAgent(w)
    expect(w.findAll('.term-tab')).toHaveLength(1)
    expect(w.find('.composer-stub').attributes('data-variant')).toBe('agent')
    // The tool is chosen in the composer, not at seed time, so no tool rides in.
    expect(w.find('.composer-stub').attributes('data-tool')).toBeUndefined()
    expect(w.text()).toContain('New session')
  })

  it('renders a terminal-variant composer for a terminal composer tab', async () => {
    const w = mountRP()
    await seedTerm(w)
    expect(w.find('.composer-stub').attributes('data-variant')).toBe('terminal')
    expect(w.text()).toContain('New shell')
  })

  it('passes lockedProject to the composer as project-name (folder-locked launch)', async () => {
    const w = mountRP()
    const spec: NewTab = { title: 'session · my-app', kind: 'composer', variant: 'agent', lockedProject: 'my-app', prefill: { folder: '/code/my-app' } }
    ;(w.props('ws') as UseWorkspace).panes.addTab(spec)
    await w.vm.$nextTick()
    expect(w.find('.composer-stub').attributes('data-project')).toBe('my-app')
  })

  it('launching interactive morphs into a terminal carrying the chosen tool', async () => {
    const w = mountRP()
    await seedAgent(w)
    await w.find('.go-int').trigger('click')
    await w.vm.$nextTick()
    expect(w.find('.composer-stub').exists()).toBe(false)
    expect(w.find('.tv').attributes('data-tool')).toBe('claude')
    expect(w.find('.tv').attributes('data-input')).toBe('ISC-835')
    expect(w.text()).toContain('orchestrator · ISC-835')
  })

  it('S5: a worktree launch makes the worktree path the terminal cwd (not the folder)', async () => {
    const w = mountRP()
    await seedAgent(w)
    await w.find('.go-wt').trigger('click')
    await w.vm.$nextTick()
    const tv = w.find('.tv')
    // cwdOverride is the WORKTREE path, so the spawn (and node-pty) runs there.
    expect(tv.attributes('data-cwd')).toBe('/cfg/worktrees/x/feat')
    expect(tv.attributes('data-worktree')).toBe('/cfg/worktrees/x/feat')
    expect(tv.attributes('data-branch')).toBe('feat')
  })

  it('launching with YOLO morphs into a yolo view', async () => {
    const w = mountRP()
    await seedAgent(w)
    await w.find('.go-yolo').trigger('click')
    await w.vm.$nextTick()
    expect(w.findAll('.yv')).toHaveLength(1)
    expect(w.findAll('.tv')).toHaveLength(0)
  })

  it('launching Terminal mode morphs into a raw shell', async () => {
    const w = mountRP()
    await seedTerm(w)
    await w.find('.go-term').trigger('click')
    await w.vm.$nextTick()
    const tv = w.find('.tv')
    expect(tv.attributes('data-shell')).toBe('pwsh')
    expect(tv.attributes('data-cwd')).toBe('C:/proj/api')
    expect(w.text()).toContain('pwsh · api')
  })

  it('opens multiple tabs and closes one', async () => {
    const w = mountRP()
    await seedAgent(w)
    await seedAgent(w)
    expect(w.findAll('.term-tab')).toHaveLength(2)
    await w.findAll('.term-tab__close')[0].trigger('click')
    expect(w.findAll('.term-tab')).toHaveLength(1)
  })

  it('each tab has a labeled button close control', async () => {
    const w = mountRP()
    await seedAgent(w)
    const close = w.find('.term-tab__close')
    expect(close.element.tagName).toBe('BUTTON')
    expect(close.attributes('aria-label')).toMatch(/^Close /)
  })

  it('startStartupSession mode=yolo opens a yolo-kind tab', async () => {
    const w = mountRP()
    ;(w.vm as unknown as { startStartupSession: (s: unknown, k?: string) => void }).startStartupSession(
      { mode: 'yolo', promptName: 'fix-bug' },
      'SD-6'
    )
    await w.vm.$nextTick()
    expect(w.findAll('.yv')).toHaveLength(1)
    expect(w.text()).toContain('fix-bug')
  })

  it('startStartupSession carries promptText as input when a role is named', async () => {
    const w = mountRP()
    ;(w.vm as unknown as { startStartupSession: (s: unknown, k?: string) => void }).startStartupSession(
      { mode: 'yolo', promptName: 'orchestrator', promptText: 'fix the login page' }
    )
    await w.vm.$nextTick()
    // The role takes the prompt slot; the spoken text must survive as the
    // input (→ {{request}}), not be silently dropped.
    expect(w.find('.yv').attributes('data-input')).toBe('fix the login page')
  })

  it('startStartupSession prefers the ticket key as input over promptText', async () => {
    const w = mountRP()
    ;(w.vm as unknown as { startStartupSession: (s: unknown, k?: string) => void }).startStartupSession(
      { mode: 'yolo', promptName: 'orchestrator', promptText: 'work the ticket' },
      'SD-20'
    )
    await w.vm.$nextTick()
    expect(w.find('.yv').attributes('data-input')).toBe('SD-20')
  })

  it('startStartupSession threads --folder into the session tab cwd', async () => {
    const w = mountRP()
    ;(w.vm as unknown as { startStartupSession: (s: unknown, k?: string) => void }).startStartupSession(
      { mode: 'interactive', promptText: 'do the thing', folder: 'C:/Users/hardy/code/seniordev-app' }
    )
    await w.vm.$nextTick()
    const tv = w.find('.tv')
    expect(tv.exists()).toBe(true)
    // The folder becomes the tab's cwdOverride → the agent spawns in a trusted dir.
    expect(tv.attributes('data-cwd')).toBe('C:/Users/hardy/code/seniordev-app')
  })

  it('openComposer opens an agent composer prefilled with the input', async () => {
    const w = mountRP()
    ;(w.vm as unknown as { openComposer: (p: { input?: string }) => void }).openComposer({ input: 'SD-6' })
    await w.vm.$nextTick()
    const composer = w.find('.composer-stub')
    expect(composer.exists()).toBe(true)
    expect(composer.attributes('data-variant')).toBe('agent')
  })

  // A run view that emits `exited` with a chosen code, so a test can exercise
  // both the clean (auto-close) and failed (kept-dead) exit cells of D3 / spec 7.2.
  function exitStubs(code: number) {
    return {
      ...stubs,
      TerminalView: {
        props: ['id', 'ticketKey', 'input', 'prompt', 'tool', 'resume', 'cwdOverride', 'shell'],
        emits: ['exited'],
        template: `<div class="tv" :data-id="id"><button class="trigger-exit" @click="$emit('exited', ${code})">exit</button></div>`
      }
    }
  }

  it('auto-closes a cleanly-exited agent tab (exit 0, spec 7.2)', async () => {
    const w = mount(RightPanel, { props: { ws: useWorkspace(), subagents: useSubagents() }, global: { stubs: exitStubs(0) } })
    await seedAgent(w)
    await w.find('.go-int').trigger('click')
    await w.vm.$nextTick()
    expect(w.findAll('.term-tab')).toHaveLength(1)
    await w.find('.trigger-exit').trigger('click')
    await w.vm.$nextTick()
    // The conversation survives in storage and stays resumable, so the tab closes.
    expect(w.findAll('.term-tab')).toHaveLength(0)
  })

  it('marks a tab dead (not closed) on a non-zero exit', async () => {
    const w = mount(RightPanel, { props: { ws: useWorkspace(), subagents: useSubagents() }, global: { stubs: exitStubs(1) } })
    await seedAgent(w)
    await w.find('.go-int').trigger('click')
    await w.vm.$nextTick()
    await w.find('.trigger-exit').trigger('click')
    await w.vm.$nextTick()
    expect(w.find('.term-tab').classes()).toContain('term-tab--dead')
  })

  it('notifies on a background tab entering needsYou, and suppresses the focused active tab', async () => {
    const NotificationMock = vi.fn()
    ;(globalThis as unknown as { Notification: unknown }).Notification = NotificationMock
    vi.spyOn(document, 'hasFocus').mockReturnValue(true) // window focused

    const w = mountRP()
    await seedAgent(w)
    await w.find('.go-int').trigger('click') // tab 1 → terminal
    await w.vm.$nextTick()
    await seedAgent(w)
    await w.find('.go-int').trigger('click') // tab 2 → terminal, now the active tab
    await w.vm.$nextTick()

    const ids = w.findAll('.tv').map((tv) => tv.attributes('data-id') as string)
    const [bgId, activeId] = ids
    expect(statusCb).toBeTypeOf('function')

    // Background tab enters needsYou → notify.
    statusCb!({ id: bgId, status: 'needsYou' })
    expect(NotificationMock).toHaveBeenCalledTimes(1)
    expect(NotificationMock.mock.calls[0][0]).toBe('Needs your input')

    // The active, focused tab enters needsYou → suppressed.
    statusCb!({ id: activeId, status: 'needsYou' })
    expect(NotificationMock).toHaveBeenCalledTimes(1) // unchanged

    // A non-attention state never notifies.
    statusCb!({ id: bgId, status: 'idle' })
    expect(NotificationMock).toHaveBeenCalledTimes(1)
  })

  // S4: a sidebar row dropped on a pane strip carries a conversation payload under
  // a custom dataTransfer type (distinct from a tab-reorder drop's ptyId).
  function convDataTransfer(payload: object) {
    return { getData: (t: string) => (t === 'application/x-sd-conversation' ? JSON.stringify(payload) : '') }
  }

  it('resumes a dropped sidebar conversation into the target pane', async () => {
    const w = mountRP()
    await seedAgent(w) // a pane with a strip now exists
    const payload = { id: 'conv-d', title: 'resumed one', tool: 'claude', cwd: '/w', agentSessionId: 'sess-d' }
    await w.find('.term-tabs').trigger('drop', { dataTransfer: convDataTransfer(payload) })
    await w.vm.$nextTick()
    const tv = w.findAll('.tv').find((n) => n.attributes('data-resume') === 'sess-d')
    expect(tv).toBeTruthy() // spawned with the resume session id
    expect(w.text()).toContain('resumed one')
  })

  it('ignores a dropped non-resumable conversation (agentSessionId null)', async () => {
    const w = mountRP()
    await seedAgent(w)
    expect(w.findAll('.term-tab')).toHaveLength(1)
    const payload = { id: 'c-null', title: 'nope', tool: 'codex', cwd: '/w', agentSessionId: null }
    await w.find('.term-tabs').trigger('drop', { dataTransfer: convDataTransfer(payload) })
    await w.vm.$nextTick()
    expect(w.findAll('.term-tab')).toHaveLength(1) // nothing spawned
  })

  // S5 follow-up: a sidebar conversation dropped on a shoulder spins off a NEW split
  // column with that session; dropped on a pane's body overlay it opens in THAT pane.
  it('dropping a conversation on the right shoulder opens it in a new split column', async () => {
    const w = mountRP()
    await seedAgent(w) // one pane, one tab
    const payload = { id: 'conv-e', title: 'edge one', tool: 'claude', cwd: '/w', agentSessionId: 'sess-e' }
    await w.find('.pane-edge--right').trigger('drop', { dataTransfer: convDataTransfer(payload) })
    await w.vm.$nextTick()
    expect(w.findAll('.pane')).toHaveLength(2) // a new column was created
    const tv = w.findAll('.tv').find((n) => n.attributes('data-resume') === 'sess-e')
    expect(tv).toBeTruthy()
  })

  it('dropping a conversation on the pane body overlay opens it in that pane', async () => {
    const w = mountRP()
    await seedAgent(w)
    const payload = { id: 'conv-b', title: 'body one', tool: 'claude', cwd: '/w', agentSessionId: 'sess-b' }
    await w.find('.pane-drop').trigger('drop', { dataTransfer: convDataTransfer(payload) })
    await w.vm.$nextTick()
    expect(w.findAll('.pane')).toHaveLength(1) // same pane, no new column
    expect(w.findAll('.tv').find((n) => n.attributes('data-resume') === 'sess-b')).toBeTruthy()
  })

  it('the shoulders and pane overlay light up during a sidebar conversation drag', async () => {
    // Assert the v-show effect on the inline style directly: isVisible()'s
    // ancestor walk is unreliable on a detached test mount, but the display toggle
    // is exactly what v-show="dragActive" drives.
    const ws = useWorkspace()
    const w = mount(RightPanel, { props: { ws, subagents: useSubagents() }, global: { stubs } })
    await seedAgent(w)
    expect(w.find('.pane-drop').attributes('style')).toContain('display: none')
    expect(w.find('.pane-edge--right').attributes('style')).toContain('display: none')
    ws.draggingConversation.value = true
    await w.vm.$nextTick()
    expect(w.find('.pane-drop').attributes('style') ?? '').not.toContain('display: none')
    expect(w.find('.pane-edge--right').attributes('style') ?? '').not.toContain('display: none')
  })

  it('yolo resume opens a terminal tab with resume + cwdOverride', async () => {
    const w = mountRP()
    ;(w.vm as unknown as { startStartupSession: (s: unknown, k?: string) => void }).startStartupSession(
      { mode: 'yolo', promptName: 'fix-bug' }
    )
    await w.vm.$nextTick()
    await w.find('.trigger-resume').trigger('click')
    await w.vm.$nextTick()
    const tv = w.find('.tv')
    expect(tv.attributes('data-resume')).toBe('sid')
    expect(tv.attributes('data-cwd')).toBe('C:/x')
    const resumedTab = w.findAll('.term-tab').find((t) => t.text().includes('(resumed)'))
    expect(resumedTab).toBeTruthy()
  })
})

// Schedule badge on a live tab (scheduled-prompts feature). The sidebar carries
// the same affordance for conversations generally; this covers the tab strip,
// where the word lives in the title/aria-label because the strip is tight.
describe('RightPanel schedule badge', () => {
  function schedule(): Schedule {
    return {
      id: 's1', enabled: true, title: 'nightly sweep',
      target: { kind: 'conversation', conversationId: 'conv-1' },
      prompt: 'go', trigger: { kind: 'daily', hour: 5, minute: 0 },
      catchUp: false, maxFirings: 10, stopOnFailure: true,
      firedCount: 0, nextDueAt: Date.now() + 4 * 3600_000,
      lastFiredAt: null, lastOutcome: null, lastReason: null, deferredSinceAt: null, createdAt: 0
    }
  }
  function badgesFor(found: Schedule | null): UseScheduleBadges {
    return {
      schedules: ref<Schedule[]>(found ? [found] : []),
      now: ref(Date.now()),
      start: () => {},
      stop: () => {},
      soonestFor: (id) => (found && id === 'conv-1' ? found : null)
    }
  }
  async function mountWith(b?: UseScheduleBadges) {
    const ws = useWorkspace()
    const w = mount(RightPanel, {
      props: { ws, subagents: useSubagents(), scheduleBadges: b },
      global: { stubs }
    })
    ws.panes.addTab({ title: 'session', kind: 'terminal', variant: 'agent', conversationId: 'conv-1' })
    await w.vm.$nextTick()
    return w
  }

  it('marks a tab whose session has something queued to type into it', async () => {
    const w = await mountWith(badgesFor(schedule()))
    const badge = w.find('.term-tab__sched')
    expect(badge.exists()).toBe(true)
    // Never a bare glyph: the sentence rides on the accessible name and the title.
    expect(badge.attributes('aria-label')).toContain('nightly sweep')
    expect(badge.attributes('title')).toContain('next')
  })

  it('leaves an unscheduled tab unmarked', async () => {
    const w = await mountWith(badgesFor(null))
    expect(w.find('.term-tab__sched').exists()).toBe(false)
  })

  it('renders normally when no badges are supplied at all', async () => {
    const w = await mountWith(undefined)
    expect(w.find('.term-tab__sched').exists()).toBe(false)
  })
})

// A scheduled resume main pushed here. Main records the firing as `fired` before
// pushing, so a path this component cannot complete has to report back or the
// schedule is left claiming a prompt that was never delivered.
describe('RightPanel scheduled resume', () => {
  const resume: ScheduledResume = {
    conversationId: 'conv-1',
    prompt: 'continue',
    scheduleId: 's1',
    title: 'nightly sweep'
  }
  const conv: ConversationInfo = {
    id: 'conv-1', projectId: 'p1', title: 'session', tool: 'claude',
    agentSessionId: 'sid-1', resumable: true, cwd: '/x',
    worktreePath: null, branch: null, lastActiveAt: 0, createdAt: 0, archivedAt: null
  }
  const dropped = (): ReturnType<typeof vi.fn> =>
    window.api.scheduleResumeDropped as unknown as ReturnType<typeof vi.fn>
  const listConversations = (): ReturnType<typeof vi.fn> =>
    window.api.listConversations as unknown as ReturnType<typeof vi.fn>

  async function fire(w: ReturnType<typeof mountRP>): Promise<void> {
    await (w.vm as unknown as { startScheduledResume: (r: ScheduledResume) => Promise<void> }).startScheduledResume(resume)
    await w.vm.$nextTick()
  }

  it('reopens the conversation past a tab whose process has exited', async () => {
    // An exited tab keeps its conversationId and stays on screen; treating it as
    // live swallowed the prompt entirely.
    const w = mountRP()
    const ws = w.props('ws') as UseWorkspace
    const tab = ws.panes.addTab({ title: 'session', kind: 'terminal', variant: 'agent', conversationId: 'conv-1' })
    ws.panes.markExited(tab.ptyId)
    listConversations().mockResolvedValue([conv])
    await fire(w)
    expect(dropped()).not.toHaveBeenCalled()
    expect(ws.panes.findLiveByConversationId('conv-1')).not.toBeNull()
  })

  it('reports the prompt undelivered when a live tab already holds the conversation', async () => {
    const w = mountRP()
    const ws = w.props('ws') as UseWorkspace
    ws.panes.addTab({ title: 'session', kind: 'terminal', variant: 'agent', conversationId: 'conv-1' })
    await fire(w)
    expect(ws.panes.allTabs.value).toHaveLength(1) // no second tab opened
    expect(dropped()).toHaveBeenCalledWith({
      title: 'nightly sweep',
      reason: expect.stringContaining('not delivered')
    })
  })

  it('reports a conversation list that could not be read', async () => {
    const w = mountRP()
    listConversations().mockRejectedValue(new Error('ipc down'))
    await fire(w)
    expect(dropped()).toHaveBeenCalledWith({
      title: 'nightly sweep',
      reason: expect.stringContaining('could not be read')
    })
  })

  it('reports a conversation with no session id to resume', async () => {
    const w = mountRP()
    listConversations().mockResolvedValue([{ ...conv, agentSessionId: null }])
    await fire(w)
    expect((w.props('ws') as UseWorkspace).panes.allTabs.value).toHaveLength(0)
    expect(dropped()).toHaveBeenCalledWith({
      title: 'nightly sweep',
      reason: expect.stringContaining('no session id')
    })
  })
})

// Supervision slice 2. The gate badge is deliberately SEPARATE from StatusGlyph:
// the status is the session's state, the gate is the code's, and a tab can be
// needsYou with a passing gate or idle with a failing one.
describe('RightPanel — gate badge', () => {
  async function seedLaunchedTab(w: ReturnType<typeof mountRP>): Promise<string> {
    await seedAgent(w)
    await w.find('.go-int').trigger('click')
    await w.vm.$nextTick()
    return (w.props('ws') as UseWorkspace).panes.allTabs.value[0].tab.ptyId
  }

  it('shows no badge until a gate reports', async () => {
    const w = mountRP()
    await seedLaunchedTab(w)
    expect(w.find('.term-tab__gate').exists()).toBe(false)
  })

  it('marks the tab while its gate runs', async () => {
    const w = mountRP()
    const ptyId = await seedLaunchedTab(w)
    gateRunningCb!({ ptyId, command: 'pnpm test' })
    await w.vm.$nextTick()
    const badge = w.find('.term-tab__gate')
    expect(badge.exists()).toBe(true)
    expect(badge.attributes('aria-label')).toMatch(/gate running/i)
  })

  it('shows a pass with a glyph and a spelled-out label, never colour alone', async () => {
    const w = mountRP()
    const ptyId = await seedLaunchedTab(w)
    gateResultCb!({ ptyId, outcome: 'pass', summary: 'Tests  3 passed (3)', durationMs: 1200, command: 'pnpm test' })
    await w.vm.$nextTick()
    const badge = w.find('.term-tab__gate')
    expect(badge.text()).toBe('✓')
    expect(badge.classes()).toContain('gate--pass')
    expect(badge.attributes('aria-label')).toMatch(/gate passed/i)
  })

  it('shows a fail distinctly from a pass', async () => {
    const w = mountRP()
    const ptyId = await seedLaunchedTab(w)
    gateResultCb!({ ptyId, outcome: 'fail', summary: '1 failed', durationMs: 900, command: 'pnpm test' })
    await w.vm.$nextTick()
    const badge = w.find('.term-tab__gate')
    expect(badge.text()).toBe('✗')
    expect(badge.attributes('aria-label')).toMatch(/gate failed/i)
  })

  it('says a broken gate could not run, rather than calling the code failed', async () => {
    const w = mountRP()
    const ptyId = await seedLaunchedTab(w)
    gateResultCb!({ ptyId, outcome: 'error', summary: 'command not found', durationMs: 0, command: 'pnpm test' })
    await w.vm.$nextTick()
    const label = w.find('.term-tab__gate').attributes('aria-label')!
    expect(label).toMatch(/could not run/i)
    expect(label).not.toMatch(/\bfailed\b/i)
  })

  it('leaves no badge behind when the tab is closed', async () => {
    const w = mountRP()
    const ptyId = await seedLaunchedTab(w)
    gateResultCb!({ ptyId, outcome: 'pass', summary: 'ok', durationMs: 10, command: 'pnpm test' })
    await w.vm.$nextTick()
    await w.find('.term-tab__close').trigger('click')
    await w.vm.$nextTick()
    expect(w.find('.term-tab__gate').exists()).toBe(false)
  })
})
