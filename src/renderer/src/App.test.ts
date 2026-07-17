import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import App from './App.vue'
import type { DeepLink, MenuAction } from '../../shared/ipc'

let menuCb: (a: MenuAction) => void
let deepLinkCb: (l: DeepLink) => void

const rightStartStartup = vi.fn()
const rightCloseAll = vi.fn()
const rightNewTab = vi.fn()
const rightOpenComposer = vi.fn()
const rightHasSessions = vi.fn(() => false as boolean)

const stubs = {
  RightPanel: {
    name: 'RightPanel',
    template: '<div class="right" />',
    methods: {
      startStartupSession: rightStartStartup,
      closeAll: rightCloseAll,
      newTab: rightNewTab,
      openComposer: rightOpenComposer,
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
  })

  it('new-session with no sessions resets to a fresh composer immediately', async () => {
    rightHasSessions.mockReturnValue(false)
    const w = mountApp()
    await flushPromises()
    rightNewTab.mockClear()
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

  it('prefills a composer with the ticket (no auto-run, no confirm)', async () => {
    const w = mountApp()
    await flushPromises()
    rightOpenComposer.mockClear()
    deepLinkCb({ action: 'yolo', ticket: 'SD-6' })
    await flushPromises()
    expect(rightOpenComposer).toHaveBeenCalledWith({ input: 'SD-6', role: undefined, folder: undefined })
    expect(w.findComponent({ name: 'ConfirmDialog' }).exists()).toBe(false)
  })

  it('passes optional role + folder prefill through to the composer', async () => {
    mountApp()
    await flushPromises()
    rightOpenComposer.mockClear()
    deepLinkCb({ action: 'open', ticket: 'SD-6', role: 'fix-bug', folder: '~/code/sd' })
    await flushPromises()
    expect(rightOpenComposer).toHaveBeenCalledWith({ input: 'SD-6', role: 'fix-bug', folder: '~/code/sd' })
  })

  it('a cold-start startup.deeplink prefills a composer too', async () => {
    ;(window.api.getStartup as ReturnType<typeof vi.fn>).mockResolvedValue({
      tickets: ['SD-6'],
      deeplink: { action: 'open', ticket: 'SD-6' }
    })
    mountApp()
    await flushPromises()
    expect(rightOpenComposer).toHaveBeenCalledWith({ input: 'SD-6' })
  })
})
