import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import RightPanel from './RightPanel.vue'
import { useWorkspace } from '../composables/useWorkspace'
import type { StatusUpdateEvent } from '../../../shared/ipc'

// Captured so tests can drive status updates as if from main.
let statusCb: ((e: StatusUpdateEvent) => void) | null = null

beforeEach(() => {
  statusCb = null
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
    getStartup: vi.fn(async () => ({ tickets: [] }))
  }
})

const NewTabMenu = {
  emits: ['pick'],
  template: `<div class="newtab-stub">
    <button class="pick-ai" @click="$emit('pick', { variant: 'agent' })">c</button>
    <button class="pick-term" @click="$emit('pick', { variant: 'terminal' })">t</button>
  </div>`
}
const Composer = {
  name: 'Composer',
  props: ['variant', 'tool'],
  emits: ['launch'],
  template: `<div class="composer-stub" :data-variant="variant" :data-tool="tool">
    <button class="go-int" @click="$emit('launch', { mode: 'interactive', folder: 'C:/x', role: 'orchestrator', input: 'ISC-835', ticketKey: 'ISC-835', yolo: false, tool: 'claude' })">i</button>
    <button class="go-yolo" @click="$emit('launch', { mode: 'interactive', folder: 'C:/x', role: 'fix-bug', input: 'do it', yolo: true, tool: 'claude' })">y</button>
    <button class="go-term" @click="$emit('launch', { mode: 'terminal', folder: 'C:/proj/api', shell: 'pwsh' })">t</button>
  </div>`
}
const stubs = {
  NewTabMenu,
  Composer,
  TerminalView: {
    props: ['id', 'ticketKey', 'input', 'prompt', 'tool', 'resume', 'cwdOverride', 'shell'],
    template:
      '<div class="tv" :data-id="id" :data-tool="tool" :data-cwd="cwdOverride" :data-shell="shell" :data-input="input" :data-resume="resume && resume.sessionId" />'
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
  return mount(RightPanel, { props: { ws: useWorkspace() }, global: { stubs } })
}

describe('RightPanel', () => {
  it('starts with no tabs and a mascot empty state', () => {
    const w = mountRP()
    expect(w.findAll('.term-tab')).toHaveLength(0)
    expect(w.find('img.empty-state__art').exists()).toBe(true)
  })

  it('renders a single pane with no splitter until a second pane exists', async () => {
    const w = mountRP()
    await w.find('.pick-ai').trigger('click')
    expect(w.findAll('.pane')).toHaveLength(1)
    expect(w.findAll('.pane-splitter')).toHaveLength(0)
  })

  it('dragging a tab to the right edge spins off a second pane with a splitter', async () => {
    const w = mountRP()
    await w.find('.pick-ai').trigger('click')
    await w.find('.pick-ai').trigger('click') // two tabs, one pane
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
    await w.find('.pick-ai').trigger('click')
    await w.find('.pick-ai').trigger('click')
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

  it('picking AI from the menu opens an agent composer tab', async () => {
    const w = mountRP()
    await w.find('.pick-ai').trigger('click')
    expect(w.findAll('.term-tab')).toHaveLength(1)
    expect(w.find('.composer-stub').attributes('data-variant')).toBe('agent')
    // The tool is chosen in the composer, not at pick time, so no tool rides in.
    expect(w.find('.composer-stub').attributes('data-tool')).toBeUndefined()
    expect(w.text()).toContain('New session')
  })

  it('picking Terminal opens a terminal-variant composer', async () => {
    const w = mountRP()
    await w.find('.pick-term').trigger('click')
    expect(w.find('.composer-stub').attributes('data-variant')).toBe('terminal')
    expect(w.text()).toContain('New shell')
  })

  it('launching interactive morphs into a terminal carrying the chosen tool', async () => {
    const w = mountRP()
    await w.find('.pick-ai').trigger('click')
    await w.find('.go-int').trigger('click')
    await w.vm.$nextTick()
    expect(w.find('.composer-stub').exists()).toBe(false)
    expect(w.find('.tv').attributes('data-tool')).toBe('claude')
    expect(w.find('.tv').attributes('data-input')).toBe('ISC-835')
    expect(w.text()).toContain('orchestrator · ISC-835')
  })

  it('launching with YOLO morphs into a yolo view', async () => {
    const w = mountRP()
    await w.find('.pick-ai').trigger('click')
    await w.find('.go-yolo').trigger('click')
    await w.vm.$nextTick()
    expect(w.findAll('.yv')).toHaveLength(1)
    expect(w.findAll('.tv')).toHaveLength(0)
  })

  it('launching Terminal mode morphs into a raw shell', async () => {
    const w = mountRP()
    await w.find('.pick-term').trigger('click')
    await w.find('.go-term').trigger('click')
    await w.vm.$nextTick()
    const tv = w.find('.tv')
    expect(tv.attributes('data-shell')).toBe('pwsh')
    expect(tv.attributes('data-cwd')).toBe('C:/proj/api')
    expect(w.text()).toContain('pwsh · api')
  })

  it('opens multiple tabs and closes one', async () => {
    const w = mountRP()
    await w.find('.pick-ai').trigger('click')
    await w.find('.pick-ai').trigger('click')
    expect(w.findAll('.term-tab')).toHaveLength(2)
    await w.findAll('.term-tab__close')[0].trigger('click')
    expect(w.findAll('.term-tab')).toHaveLength(1)
  })

  it('each tab has a labeled button close control', async () => {
    const w = mountRP()
    await w.find('.pick-ai').trigger('click')
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
    const w = mount(RightPanel, { props: { ws: useWorkspace() }, global: { stubs: exitStubs(0) } })
    await w.find('.pick-ai').trigger('click')
    await w.find('.go-int').trigger('click')
    await w.vm.$nextTick()
    expect(w.findAll('.term-tab')).toHaveLength(1)
    await w.find('.trigger-exit').trigger('click')
    await w.vm.$nextTick()
    // The conversation survives in storage and stays resumable, so the tab closes.
    expect(w.findAll('.term-tab')).toHaveLength(0)
  })

  it('marks a tab dead (not closed) on a non-zero exit', async () => {
    const w = mount(RightPanel, { props: { ws: useWorkspace() }, global: { stubs: exitStubs(1) } })
    await w.find('.pick-ai').trigger('click')
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
    await w.find('.pick-ai').trigger('click')
    await w.find('.go-int').trigger('click') // tab 1 → terminal
    await w.vm.$nextTick()
    await w.find('.pick-ai').trigger('click')
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
    await w.find('.pick-ai').trigger('click') // a pane with a strip now exists
    const payload = { id: 'conv-d', title: 'resumed one', tool: 'claude', cwd: '/w', agentSessionId: 'sess-d' }
    await w.find('.term-tabs').trigger('drop', { dataTransfer: convDataTransfer(payload) })
    await w.vm.$nextTick()
    const tv = w.findAll('.tv').find((n) => n.attributes('data-resume') === 'sess-d')
    expect(tv).toBeTruthy() // spawned with the resume session id
    expect(w.text()).toContain('resumed one')
  })

  it('ignores a dropped non-resumable conversation (agentSessionId null)', async () => {
    const w = mountRP()
    await w.find('.pick-ai').trigger('click')
    expect(w.findAll('.term-tab')).toHaveLength(1)
    const payload = { id: 'c-null', title: 'nope', tool: 'codex', cwd: '/w', agentSessionId: null }
    await w.find('.term-tabs').trigger('drop', { dataTransfer: convDataTransfer(payload) })
    await w.vm.$nextTick()
    expect(w.findAll('.term-tab')).toHaveLength(1) // nothing spawned
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
