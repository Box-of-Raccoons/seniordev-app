import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import App from './App.vue'
import type { DeepLink, MenuAction } from '../../shared/ipc'

let menuCb: (a: MenuAction) => void
let deepLinkCb: (l: DeepLink) => void
let orchestrateCb: (ticket: string) => void

// Shared spies for the RightPanel stub; App drives it via its template ref.
const rightStartStartup = vi.fn()
const rightStartOrchestrator = vi.fn()
const rightCloseAll = vi.fn()
const rightNewTab = vi.fn()
const rightHasSessions = vi.fn(() => false as boolean)

const stubs = {
  RightPanel: {
    name: 'RightPanel',
    template: '<div class="right" />',
    methods: {
      startStartupSession: rightStartStartup,
      startOrchestrator: rightStartOrchestrator,
      closeAll: rightCloseAll,
      newTab: rightNewTab,
      hasSessions: rightHasSessions
    }
  },
  AboutModal: { name: 'AboutModal', template: '<div class="about-stub" />' },
  AppConfigModal: { name: 'AppConfigModal', template: '<div class="appcfg-stub" />' },
  PromptConfigModal: { name: 'PromptConfigModal', template: '<div class="promptcfg-stub" />' },
  ConfirmDialog: {
    name: 'ConfirmDialog',
    props: ['title', 'message', 'confirmLabel', 'hideConfirm'],
    emits: ['confirm', 'cancel'],
    template:
      '<div class="confirm-stub"><button class="confirm-yes" @click="$emit(\'confirm\')" /><button class="confirm-no" @click="$emit(\'cancel\')" /></div>'
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  rightHasSessions.mockReturnValue(false)
  ;(window as unknown as { api: unknown }).api = {
    getStartup: vi.fn().mockResolvedValue({ tickets: [] }),
    onMenuAction: vi.fn((cb) => { menuCb = cb; return () => {} }),
    onDeepLink: vi.fn((cb) => { deepLinkCb = cb; return () => {} }),
    deepLinkReady: vi.fn(),
    onOrchestrate: vi.fn((cb) => { orchestrateCb = cb; return () => {} }),
    getTicket: vi.fn().mockResolvedValue({ ok: true, ticket: { key: 'SD-6', summary: 'Fix the thing' } }),
    resolveRepo: vi.fn().mockResolvedValue({ key: 'SD', path: '/repos/seniordev', tool: 'claude' }),
    getAppInfo: vi.fn().mockResolvedValue({ name: 'SeniorDev', version: '1.0.0' })
  }
})

function mountApp() {
  return mount(App, { global: { stubs } })
}

describe('App menu wiring', () => {
  it('about opens AboutModal; a second action while open is ignored (no stacking)', async () => {
    const w = mountApp()
    await flushPromises()
    menuCb('about')
    await flushPromises()
    expect(w.findComponent({ name: 'AboutModal' }).exists()).toBe(true)
    menuCb('app-config')
    await flushPromises()
    expect(w.findComponent({ name: 'AppConfigModal' }).exists()).toBe(false)
    expect(w.findComponent({ name: 'AboutModal' }).exists()).toBe(true)
  })

  it('app-config and prompt-config open their modals', async () => {
    const w1 = mountApp()
    await flushPromises()
    menuCb('app-config')
    await flushPromises()
    expect(w1.findComponent({ name: 'AppConfigModal' }).exists()).toBe(true)

    const w2 = mountApp()
    await flushPromises()
    menuCb('prompt-config')
    await flushPromises()
    expect(w2.findComponent({ name: 'PromptConfigModal' }).exists()).toBe(true)
  })

  it('new-session with no sessions resets to a fresh composer immediately', async () => {
    rightHasSessions.mockReturnValue(false)
    const w = mountApp()
    await flushPromises()
    rightNewTab.mockClear() // ignore the boot-time newTab from the mount finally
    menuCb('new-session')
    await flushPromises()
    expect(w.findComponent({ name: 'ConfirmDialog' }).exists()).toBe(false)
    expect(rightCloseAll).toHaveBeenCalledTimes(1)
    expect(rightNewTab).toHaveBeenCalledTimes(1)
  })

  it('new-session with sessions confirms first, then resets', async () => {
    rightHasSessions.mockReturnValue(true)
    const w = mountApp()
    await flushPromises()
    menuCb('new-session')
    await flushPromises()
    expect(w.findComponent({ name: 'ConfirmDialog' }).exists()).toBe(true)
    expect(rightCloseAll).not.toHaveBeenCalled()

    await w.find('.confirm-yes').trigger('click')
    await flushPromises()
    expect(rightCloseAll).toHaveBeenCalledTimes(1)
    expect(w.findComponent({ name: 'ConfirmDialog' }).exists()).toBe(false)
  })

  it('a menu action while the reset confirm is open is ignored (no stacking)', async () => {
    rightHasSessions.mockReturnValue(true)
    const w = mountApp()
    await flushPromises()
    menuCb('new-session')
    await flushPromises()
    expect(w.findComponent({ name: 'ConfirmDialog' }).exists()).toBe(true)
    menuCb('about')
    await flushPromises()
    expect(w.findComponent({ name: 'AboutModal' }).exists()).toBe(false)
  })
})

describe('App boot', () => {
  it('opens a composer tab on boot when nothing else opens a session', async () => {
    mountApp()
    await flushPromises()
    expect(rightNewTab).toHaveBeenCalled()
  })

  describe('splash', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())
    it('shows the splash on mount, then dismisses it after startup settles', async () => {
      const w = mountApp()
      expect(w.findComponent({ name: 'Splash' }).exists()).toBe(true)
      await flushPromises()
      vi.runAllTimers()
      await flushPromises()
      expect(w.findComponent({ name: 'Splash' }).exists()).toBe(false)
    })
  })
})

describe('App deep link flow', () => {
  it('signals deep-link readiness only after the listener is registered', async () => {
    mountApp()
    await flushPromises()
    expect(window.api.deepLinkReady).toHaveBeenCalledTimes(1)
    const readyOrder = (window.api.deepLinkReady as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    const listenOrder = (window.api.onDeepLink as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    expect(listenOrder).toBeLessThan(readyOrder)
  })

  it('open action opens a fresh composer with no confirm', async () => {
    const w = mountApp()
    await flushPromises()
    rightNewTab.mockClear()
    deepLinkCb({ action: 'open', ticket: 'SD-6' })
    await flushPromises()
    expect(rightNewTab).toHaveBeenCalledTimes(1)
    expect(w.findComponent({ name: 'ConfirmDialog' }).exists()).toBe(false)
    expect(rightStartOrchestrator).not.toHaveBeenCalled()
  })

  it('yolo action gates the orchestrator behind a confirm', async () => {
    const w = mountApp()
    await flushPromises()
    deepLinkCb({ action: 'yolo', ticket: 'SD-6' })
    await flushPromises()
    const dialog = w.findComponent({ name: 'ConfirmDialog' })
    expect(dialog.exists()).toBe(true)
    expect(dialog.props('message')).toContain('SD-6')
    expect(dialog.props('message')).toContain('Fix the thing')
    expect(rightStartOrchestrator).not.toHaveBeenCalled()
    await w.find('.confirm-yes').trigger('click')
    await flushPromises()
    expect(rightStartOrchestrator).toHaveBeenCalledWith('SD-6')
    expect(w.findComponent({ name: 'ConfirmDialog' }).exists()).toBe(false)
  })

  it('yolo confirm shows external-link provenance and the resolved repo (SD-9 S2)', async () => {
    const w = mountApp()
    await flushPromises()
    deepLinkCb({ action: 'yolo', ticket: 'SD-6' })
    await flushPromises()
    const dialog = w.findComponent({ name: 'ConfirmDialog' })
    expect(dialog.props('message')).toContain('external link')
    expect(dialog.props('message')).toContain('/repos/seniordev')
    expect(dialog.props('hideConfirm')).toBeFalsy()
    expect(window.api.resolveRepo).toHaveBeenCalledWith('SD-6')
  })

  it('refuses a deep-link yolo whose project maps to no configured repo (SD-9 S2)', async () => {
    ;(window.api.resolveRepo as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const w = mountApp()
    await flushPromises()
    deepLinkCb({ action: 'yolo', ticket: 'SD-6' })
    await flushPromises()
    const dialog = w.findComponent({ name: 'ConfirmDialog' })
    expect(dialog.exists()).toBe(true)
    expect(dialog.props('hideConfirm')).toBe(true)
    expect(dialog.props('message')).toContain('No configured repo')
    await w.find('.confirm-yes').trigger('click')
    await flushPromises()
    expect(rightStartOrchestrator).not.toHaveBeenCalled()
  })

  it('declining the confirm runs nothing', async () => {
    const w = mountApp()
    await flushPromises()
    deepLinkCb({ action: 'yolo', ticket: 'SD-6' })
    await flushPromises()
    await w.find('.confirm-no').trigger('click')
    await flushPromises()
    expect(rightStartOrchestrator).not.toHaveBeenCalled()
    expect(w.findComponent({ name: 'ConfirmDialog' }).exists()).toBe(false)
  })

  it('a cold-start startup.deeplink shows the same confirm', async () => {
    ;(window.api.getStartup as ReturnType<typeof vi.fn>).mockResolvedValue({
      tickets: ['SD-6'],
      deeplink: { action: 'yolo', ticket: 'SD-6' }
    })
    const w = mountApp()
    await flushPromises()
    expect(w.findComponent({ name: 'ConfirmDialog' }).exists()).toBe(true)
    await w.find('.confirm-yes').trigger('click')
    expect(rightStartOrchestrator).toHaveBeenCalledWith('SD-6')
  })

  it('a cold-start startup.orchestrate runs the orchestrator with NO confirm gate', async () => {
    ;(window.api.getStartup as ReturnType<typeof vi.fn>).mockResolvedValue({ tickets: [], orchestrate: 'SD-6' })
    const w = mountApp()
    await flushPromises()
    expect(rightStartOrchestrator).toHaveBeenCalledWith('SD-6')
    expect(w.findComponent({ name: 'ConfirmDialog' }).exists()).toBe(false)
  })

  it('a warm ORCHESTRATOR.run runs the orchestrator with no gate', async () => {
    const w = mountApp()
    await flushPromises()
    orchestrateCb('SD-7')
    await flushPromises()
    expect(rightStartOrchestrator).toHaveBeenCalledWith('SD-7')
    expect(w.findComponent({ name: 'ConfirmDialog' }).exists()).toBe(false)
  })
})
