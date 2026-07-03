import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import RightPanel from './RightPanel.vue'

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    spawnTerminal: vi.fn(async () => ({ ok: true })),
    writeTerminal: vi.fn(), resizeTerminal: vi.fn(), killTerminal: vi.fn(),
    onTerminalData: vi.fn(() => () => {}), onTerminalExit: vi.fn(() => () => {}),
    openExternal: vi.fn(async () => ({ ok: true })),
    listPrompts: vi.fn(async () => []),
    yoloCaps: vi.fn(async () => ({ available: true })),
    getStartup: vi.fn(async () => ({ tickets: [] }))
  }
})

const stubs = {
  TerminalView: {
    props: ['id', 'ticketKey', 'prompt', 'tool', 'resume', 'cwdOverride'],
    template:
      '<div class="tv" :data-id="id" :data-tool="tool" :data-cwd="cwdOverride" :data-resume="resume && resume.sessionId" />'
  },
  YoloView: {
    props: ['id', 'ticketKey', 'prompt', 'tool'],
    emits: ['exited', 'resume'],
    template:
      '<div class="yv" :data-id="id"><button class="trigger-resume" @click="$emit(\'resume\', { sessionId: \'sid\', cwd: \'C:/x\', tool: \'claude\' })">resume</button></div>'
  },
  OrchestratorView: {
    props: ['id', 'ticketKey', 'tool'],
    emits: ['exited', 'resume', 'routed'],
    template:
      '<div class="ov" :data-id="id" :data-ticket-key="ticketKey"><button class="trigger-routed" @click="$emit(\'routed\', \'fix-bug\')">route</button></div>'
  },
  NewSessionMenu: { template: '<button class="new-session" @click="$emit(\'start\', { yolo: false })" />' }
}

describe('RightPanel', () => {
  it('starts with no terminals and an empty state', () => {
    const w = mount(RightPanel, { props: { activeTicketKey: null }, global: { stubs } })
    expect(w.findAll('.term-tab')).toHaveLength(0)
    expect(w.text()).toContain('New session')
  })

  it('opens a terminal tab on New session', async () => {
    const w = mount(RightPanel, { props: { activeTicketKey: 'PROJ-1' }, global: { stubs } })
    await w.find('.new-session').trigger('click')
    expect(w.findAll('.term-tab')).toHaveLength(1)
    expect(w.findAll('.tv')).toHaveLength(1)
  })

  it('opens multiple tabs and closes one', async () => {
    const w = mount(RightPanel, { props: { activeTicketKey: null }, global: { stubs } })
    await w.find('.new-session').trigger('click')
    await w.find('.new-session').trigger('click')
    expect(w.findAll('.term-tab')).toHaveLength(2)
    await w.findAll('.term-tab__close')[0].trigger('click')
    expect(w.findAll('.term-tab')).toHaveLength(1)
  })

  it('titles a prompt session by the prompt name', async () => {
    const w = mount(RightPanel, { props: { activeTicketKey: null }, global: { stubs: {
      TerminalView: stubs.TerminalView,
      NewSessionMenu: { template: '<button class="np" @click="$emit(\'start\', { prompt: { name: \'fix-bug\' } })" />' }
    } } })
    await w.find('.np').trigger('click')
    expect(w.text()).toContain('fix-bug')
  })

  it('marks a yolo session title', async () => {
    const w = mount(RightPanel, { props: { activeTicketKey: null }, global: { stubs: {
      TerminalView: stubs.TerminalView,
      YoloView: stubs.YoloView,
      NewSessionMenu: { template: '<button class="np" @click="$emit(\'start\', { prompt: { name: \'fix\' }, yolo: true })" />' }
    } } })
    await w.find('.np').trigger('click')
    expect(w.text()).toContain('fix')
  })

  it('starts a session from startStartupSession', async () => {
    const w = mount(RightPanel, { props: { activeTicketKey: null }, global: { stubs } })
    ;(w.vm as unknown as { startStartupSession: (s: unknown) => void }).startStartupSession({ mode: 'yolo', promptName: 'ship-it' })
    await w.vm.$nextTick()
    expect(w.text()).toContain('ship-it')
  })

  it('marks a tab as dead when TerminalView emits exited', async () => {
    const exitStubs = {
      TerminalView: {
        props: ['id', 'ticketKey', 'prompt', 'tool', 'resume', 'cwdOverride'],
        emits: ['exited'],
        template: '<div class="tv" :data-id="id"><button class="trigger-exit" @click="$emit(\'exited\', 0)">exit</button></div>'
      },
      NewSessionMenu: stubs.NewSessionMenu
    }
    const w = mount(RightPanel, { props: { activeTicketKey: null }, global: { stubs: exitStubs } })
    await w.find('.new-session').trigger('click')
    await w.find('.trigger-exit').trigger('click')
    await w.vm.$nextTick()
    expect(w.find('.term-tab').classes()).toContain('term-tab--dead')
  })

  it('startStartupSession mode=yolo opens a yolo-kind tab', async () => {
    const w = mount(RightPanel, { props: { activeTicketKey: null }, global: { stubs } })
    ;(w.vm as unknown as { startStartupSession: (s: unknown) => void }).startStartupSession({
      mode: 'yolo',
      promptName: 'fix-bug'
    })
    await w.vm.$nextTick()
    expect(w.findAll('.yv')).toHaveLength(1)
    expect(w.findAll('.tv')).toHaveLength(0)
  })

  it('startOrchestrator opens an orchestrator tab with the ticket key', async () => {
    const w = mount(RightPanel, { props: { activeTicketKey: 'SD-6' }, global: { stubs } })
    ;(w.vm as unknown as { startOrchestrator: (key: string) => void }).startOrchestrator('SD-6')
    await w.vm.$nextTick()
    const ov = w.find('.ov')
    expect(ov.exists()).toBe(true)
    expect(ov.attributes('data-ticket-key')).toBe('SD-6')
    expect(w.text()).toContain('Jira Orchestrator')
  })

  it('routed event updates the orchestrator tab title', async () => {
    const w = mount(RightPanel, { props: { activeTicketKey: 'SD-6' }, global: { stubs } })
    ;(w.vm as unknown as { startOrchestrator: (key: string) => void }).startOrchestrator('SD-6')
    await w.vm.$nextTick()
    await w.find('.trigger-routed').trigger('click')
    await w.vm.$nextTick()
    const tab = w.find('.term-tab')
    expect(tab.text()).toContain('Jira Orchestrator → fix-bug')
  })

  it('yolo resume event opens a terminal tab with resume + cwdOverride', async () => {
    const w = mount(RightPanel, { props: { activeTicketKey: null }, global: { stubs } })
    ;(w.vm as unknown as { startStartupSession: (s: unknown) => void }).startStartupSession({
      mode: 'yolo',
      promptName: 'fix-bug'
    })
    await w.vm.$nextTick()
    // YoloView asks to resume → RightPanel opens a new terminal-kind tab.
    await w.find('.trigger-resume').trigger('click')
    await w.vm.$nextTick()
    const tv = w.find('.tv')
    expect(tv.exists()).toBe(true)
    expect(tv.attributes('data-resume')).toBe('sid')
    expect(tv.attributes('data-cwd')).toBe('C:/x')
    expect(tv.attributes('data-tool')).toBe('claude')
    // Resumed tab title is `${from.title} (resumed)` — yolo tab was 'fix-bug 1'.
    const resumedTab = w.findAll('.term-tab').find((t) => t.text().includes('(resumed)'))
    expect(resumedTab).toBeTruthy()
    expect(resumedTab!.text()).toContain('fix-bug 1 (resumed)')
  })

  it('shows mascot empty state before any session is started', () => {
    const w = mount(RightPanel, { props: { activeTicketKey: null }, global: { stubs } })
    const img = w.find('img.empty-state__art')
    expect(img.exists()).toBe(true)
    expect(img.attributes('alt')).toBe('')
    expect(w.text()).toContain('No sessions')
  })

  it('hides the mascot empty state after a session is started', async () => {
    const w = mount(RightPanel, { props: { activeTicketKey: null }, global: { stubs } })
    await w.find('.new-session').trigger('click')
    expect(w.find('img.empty-state__art').exists()).toBe(false)
  })
})
