import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import RightPanel from './RightPanel.vue'

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    spawnTerminal: vi.fn(async () => ({ ok: true })),
    spawnShell: vi.fn(async () => ({ ok: true })),
    writeTerminal: vi.fn(), resizeTerminal: vi.fn(), killTerminal: vi.fn(),
    onTerminalData: vi.fn(() => () => {}), onTerminalExit: vi.fn(() => () => {}),
    openExternal: vi.fn(async () => ({ ok: true })),
    listPrompts: vi.fn(async () => []), listRepos: vi.fn(async () => []),
    listShells: vi.fn(async () => ({ shells: ['pwsh'], default: 'pwsh' })),
    resolveRepo: vi.fn(async () => null),
    yoloCaps: vi.fn(async () => ({ available: true })),
    getStartup: vi.fn(async () => ({ tickets: [] }))
  }
})

// Composer stub: three launch buttons for the interactive / yolo / terminal paths.
const Composer = {
  name: 'Composer',
  emits: ['launch'],
  template: `<div class="composer-stub">
    <button class="go-int" @click="$emit('launch', { mode: 'interactive', folder: 'C:/x', role: 'orchestrator', input: 'ISC-835', ticketKey: 'ISC-835', yolo: false })">i</button>
    <button class="go-yolo" @click="$emit('launch', { mode: 'interactive', folder: 'C:/x', role: 'fix-bug', input: 'do it', yolo: true })">y</button>
    <button class="go-term" @click="$emit('launch', { mode: 'terminal', folder: 'C:/proj/api', shell: 'pwsh' })">t</button>
  </div>`
}
const stubs = {
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
  },
  OrchestratorView: {
    props: ['id', 'ticketKey', 'tool'],
    emits: ['exited', 'resume', 'routed'],
    template:
      '<div class="ov" :data-id="id" :data-ticket-key="ticketKey"><button class="trigger-routed" @click="$emit(\'routed\', \'fix-bug\')">route</button></div>'
  }
}

function mountRP() {
  return mount(RightPanel, { global: { stubs } })
}

describe('RightPanel', () => {
  it('starts with no tabs and a mascot empty state', () => {
    const w = mountRP()
    expect(w.findAll('.term-tab')).toHaveLength(0)
    expect(w.find('img.empty-state__art').exists()).toBe(true)
    expect(w.text()).toContain('No sessions')
  })

  it('opens a composer tab on "+"', async () => {
    const w = mountRP()
    await w.find('.new-session').trigger('click')
    expect(w.findAll('.term-tab')).toHaveLength(1)
    expect(w.find('.composer-stub').exists()).toBe(true)
    expect(w.text()).toContain('New session')
  })

  it('launching interactive morphs the composer tab into a terminal, titled role + ticket', async () => {
    const w = mountRP()
    await w.find('.new-session').trigger('click')
    await w.find('.go-int').trigger('click')
    await w.vm.$nextTick()
    expect(w.find('.composer-stub').exists()).toBe(false)
    expect(w.find('.tv').exists()).toBe(true)
    expect(w.find('.tv').attributes('data-input')).toBe('ISC-835')
    expect(w.find('.tv').attributes('data-cwd')).toBe('C:/x')
    expect(w.text()).toContain('orchestrator · ISC-835')
  })

  it('launching with YOLO morphs into a yolo view', async () => {
    const w = mountRP()
    await w.find('.new-session').trigger('click')
    await w.find('.go-yolo').trigger('click')
    await w.vm.$nextTick()
    expect(w.findAll('.yv')).toHaveLength(1)
    expect(w.findAll('.tv')).toHaveLength(0)
    expect(w.find('.yv').attributes('data-input')).toBe('do it')
  })

  it('launching Terminal mode morphs into a raw shell', async () => {
    const w = mountRP()
    await w.find('.new-session').trigger('click')
    await w.find('.go-term').trigger('click')
    await w.vm.$nextTick()
    const tv = w.find('.tv')
    expect(tv.exists()).toBe(true)
    expect(tv.attributes('data-shell')).toBe('pwsh')
    expect(tv.attributes('data-cwd')).toBe('C:/proj/api')
    expect(w.text()).toContain('pwsh · api')
  })

  it('opens multiple tabs and closes one', async () => {
    const w = mountRP()
    await w.find('.new-session').trigger('click')
    await w.find('.new-session').trigger('click')
    expect(w.findAll('.term-tab')).toHaveLength(2)
    await w.findAll('.term-tab__close')[0].trigger('click')
    expect(w.findAll('.term-tab')).toHaveLength(1)
  })

  it('each tab has a labeled button close control', async () => {
    const w = mountRP()
    await w.find('.new-session').trigger('click')
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
    expect(w.findAll('.tv')).toHaveLength(0)
    expect(w.text()).toContain('fix-bug')
  })

  it('startOrchestrator opens an orchestrator tab with the ticket key', async () => {
    const w = mountRP()
    ;(w.vm as unknown as { startOrchestrator: (key: string) => void }).startOrchestrator('SD-6')
    await w.vm.$nextTick()
    const ov = w.find('.ov')
    expect(ov.exists()).toBe(true)
    expect(ov.attributes('data-ticket-key')).toBe('SD-6')
    expect(w.text()).toContain('Jira Orchestrator')
  })

  it('routed event updates the orchestrator tab title', async () => {
    const w = mountRP()
    ;(w.vm as unknown as { startOrchestrator: (key: string) => void }).startOrchestrator('SD-6')
    await w.vm.$nextTick()
    await w.find('.trigger-routed').trigger('click')
    await w.vm.$nextTick()
    expect(w.find('.term-tab').text()).toContain('Jira Orchestrator → fix-bug')
  })

  it('marks a tab dead when the run view emits exited', async () => {
    const exitStubs = {
      ...stubs,
      TerminalView: {
        props: ['id', 'ticketKey', 'input', 'prompt', 'tool', 'resume', 'cwdOverride', 'shell'],
        emits: ['exited'],
        template: '<div class="tv" :data-id="id"><button class="trigger-exit" @click="$emit(\'exited\', 0)">exit</button></div>'
      }
    }
    const w = mount(RightPanel, { global: { stubs: exitStubs } })
    await w.find('.new-session').trigger('click')
    await w.find('.go-int').trigger('click')
    await w.vm.$nextTick()
    await w.find('.trigger-exit').trigger('click')
    await w.vm.$nextTick()
    expect(w.find('.term-tab').classes()).toContain('term-tab--dead')
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
    expect(tv.exists()).toBe(true)
    expect(tv.attributes('data-resume')).toBe('sid')
    expect(tv.attributes('data-cwd')).toBe('C:/x')
    expect(tv.attributes('data-tool')).toBe('claude')
    const resumedTab = w.findAll('.term-tab').find((t) => t.text().includes('(resumed)'))
    expect(resumedTab).toBeTruthy()
  })
})
