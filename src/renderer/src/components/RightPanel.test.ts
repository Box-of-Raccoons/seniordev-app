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
    listTools: vi.fn(async () => ['claude']),
    resolveRepo: vi.fn(async () => null),
    yoloCaps: vi.fn(async () => ({ available: true })),
    onConfigChanged: vi.fn(() => () => {}),
    getStartup: vi.fn(async () => ({ tickets: [] }))
  }
})

const NewTabMenu = {
  emits: ['pick'],
  template: `<div class="newtab-stub">
    <button class="pick-claude" @click="$emit('pick', { variant: 'agent', tool: 'claude' })">c</button>
    <button class="pick-term" @click="$emit('pick', { variant: 'terminal' })">t</button>
  </div>`
}
const Composer = {
  name: 'Composer',
  props: ['variant', 'tool'],
  emits: ['launch'],
  template: `<div class="composer-stub" :data-variant="variant" :data-tool="tool">
    <button class="go-int" @click="$emit('launch', { mode: 'interactive', folder: 'C:/x', role: 'orchestrator', input: 'ISC-835', ticketKey: 'ISC-835', yolo: false, tool })">i</button>
    <button class="go-yolo" @click="$emit('launch', { mode: 'interactive', folder: 'C:/x', role: 'fix-bug', input: 'do it', yolo: true, tool })">y</button>
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

function mountRP() {
  return mount(RightPanel, { global: { stubs } })
}

describe('RightPanel', () => {
  it('starts with no tabs and a mascot empty state', () => {
    const w = mountRP()
    expect(w.findAll('.term-tab')).toHaveLength(0)
    expect(w.find('img.empty-state__art').exists()).toBe(true)
  })

  it('picking Claude from the menu opens an agent composer tab', async () => {
    const w = mountRP()
    await w.find('.pick-claude').trigger('click')
    expect(w.findAll('.term-tab')).toHaveLength(1)
    expect(w.find('.composer-stub').attributes('data-variant')).toBe('agent')
    expect(w.find('.composer-stub').attributes('data-tool')).toBe('claude')
    expect(w.text()).toContain('Claude')
  })

  it('picking Terminal opens a terminal-variant composer', async () => {
    const w = mountRP()
    await w.find('.pick-term').trigger('click')
    expect(w.find('.composer-stub').attributes('data-variant')).toBe('terminal')
    expect(w.text()).toContain('New shell')
  })

  it('launching interactive morphs into a terminal carrying the chosen tool', async () => {
    const w = mountRP()
    await w.find('.pick-claude').trigger('click')
    await w.find('.go-int').trigger('click')
    await w.vm.$nextTick()
    expect(w.find('.composer-stub').exists()).toBe(false)
    expect(w.find('.tv').attributes('data-tool')).toBe('claude')
    expect(w.find('.tv').attributes('data-input')).toBe('ISC-835')
    expect(w.text()).toContain('orchestrator · ISC-835')
  })

  it('launching with YOLO morphs into a yolo view', async () => {
    const w = mountRP()
    await w.find('.pick-claude').trigger('click')
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
    await w.find('.pick-claude').trigger('click')
    await w.find('.pick-claude').trigger('click')
    expect(w.findAll('.term-tab')).toHaveLength(2)
    await w.findAll('.term-tab__close')[0].trigger('click')
    expect(w.findAll('.term-tab')).toHaveLength(1)
  })

  it('each tab has a labeled button close control', async () => {
    const w = mountRP()
    await w.find('.pick-claude').trigger('click')
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
    await w.find('.pick-claude').trigger('click')
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
    expect(tv.attributes('data-resume')).toBe('sid')
    expect(tv.attributes('data-cwd')).toBe('C:/x')
    const resumedTab = w.findAll('.term-tab').find((t) => t.text().includes('(resumed)'))
    expect(resumedTab).toBeTruthy()
  })
})
