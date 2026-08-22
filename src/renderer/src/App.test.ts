import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import App from './App.vue'
import type { DeepLink, MenuAction, WarmStartup, ScheduledResume } from '../../shared/ipc'

// Unmount every mounted App after each test. App adds a window-level keydown
// listener (capture phase) for the pane-move shortcut; without auto-unmount those
// listeners leak across tests and fire on later dispatches.
enableAutoUnmount(afterEach)

let menuCb: (a: MenuAction) => void
let deepLinkCb: (l: DeepLink) => void
let startupSessionCb: (w: WarmStartup) => void

const rightStartStartup = vi.fn()
const rightStartScheduledResume = vi.fn()
let scheduledResumeCb: (r: ScheduledResume) => void
const rightCloseAll = vi.fn()
const rightNewTab = vi.fn()
const rightOpenComposer = vi.fn()
const rightHasSessions = vi.fn(() => false as boolean)
const rightMoveActiveTab = vi.fn()

const stubs = {
  RightPanel: {
    name: 'RightPanel',
    props: ['ws'],
    template: '<div class="right" />',
    methods: {
      startStartupSession: rightStartStartup,
      startScheduledResume: rightStartScheduledResume,
      closeAll: rightCloseAll,
      newTab: rightNewTab,
      openComposer: rightOpenComposer,
      hasSessions: rightHasSessions,
      moveActiveTab: rightMoveActiveTab
    }
  },
  Sidebar: { name: 'Sidebar', props: ['ws'], template: '<div class="sidebar-stub" />' },
  AboutModal: { name: 'AboutModal', template: '<div class="about-stub" />' },
  AppConfigModal: { name: 'AppConfigModal', template: '<div class="appcfg-stub" />' },
  SchedulesModal: { name: 'SchedulesModal', template: '<div class="schedules-stub" />' },
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
    onStartupSession: vi.fn((cb) => { startupSessionCb = cb; return () => {} }),
    onScheduledResume: vi.fn((cb) => { scheduledResumeCb = cb; return () => {} }),
    deepLinkReady: vi.fn(),
    getAppInfo: vi.fn().mockResolvedValue({ name: 'SeniorDev', version: '1.0.0' }),
    installUpdate: vi.fn(),
    // S8: the subagent panel starts its watchers + known-session refresh on mount.
    onSubagentSpawn: vi.fn(() => () => {}),
    onSubagentActivity: vi.fn(() => () => {}),
    onSubagentDone: vi.fn(() => () => {}),
    onSidebarChanged: vi.fn(() => () => {}),
    listConversations: vi.fn().mockResolvedValue([]),
    getSidebarState: vi.fn().mockResolvedValue({ width: null, collapsed: false, suppressTeardownConfirm: false })
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

  it('an install request confirms first, naming how many sessions the restart kills', async () => {
    const w = mountApp()
    await flushPromises()
    // Two live sessions plus a composer (which owns no pty and must not be counted).
    const ws = w.findComponent({ name: 'RightPanel' }).props('ws') as {
      panes: { addTab: (t: Record<string, unknown>) => void }
    }
    ws.panes.addTab({ title: 'one', kind: 'terminal' })
    ws.panes.addTab({ title: 'two', kind: 'yolo' })
    ws.panes.addTab({ title: 'draft', kind: 'composer' })

    menuCb('about')
    await flushPromises()
    w.findComponent({ name: 'AboutModal' }).vm.$emit('install')
    await flushPromises()

    // About closes, the confirm takes over — no stacked modals.
    expect(w.findComponent({ name: 'AboutModal' }).exists()).toBe(false)
    const confirm = w.findComponent({ name: 'ConfirmDialog' })
    expect(confirm.exists()).toBe(true)
    expect(confirm.props('message')).toContain('closes 2 running sessions')
    expect(window.api.installUpdate).not.toHaveBeenCalled() // not until confirmed

    await confirm.get('button.confirm-yes').trigger('click')
    expect(window.api.installUpdate).toHaveBeenCalledTimes(1)
  })

  it('cancelling the install confirm leaves the app running and installs nothing', async () => {
    const w = mountApp()
    await flushPromises()
    menuCb('about')
    await flushPromises()
    w.findComponent({ name: 'AboutModal' }).vm.$emit('install')
    await flushPromises()

    // With no sessions open the message drops the warning rather than saying "0".
    const confirm = w.findComponent({ name: 'ConfirmDialog' })
    expect(confirm.props('message')).toBe('SeniorDev will restart to install the update.')
    await confirm.get('button.confirm-no').trigger('click')
    await flushPromises()
    expect(w.findComponent({ name: 'ConfirmDialog' }).exists()).toBe(false)
    expect(window.api.installUpdate).not.toHaveBeenCalled()
  })

  it('move-tab menu actions route to RightPanel.moveActiveTab with a direction', async () => {
    const w = mountApp()
    await flushPromises()
    menuCb('move-tab-left')
    menuCb('move-tab-right')
    await flushPromises()
    expect(rightMoveActiveTab).toHaveBeenNthCalledWith(1, -1)
    expect(rightMoveActiveTab).toHaveBeenNthCalledWith(2, 1)
    // A move action must not open a modal.
    expect(w.findComponent({ name: 'AppConfigModal' }).exists()).toBe(false)
  })

  it('Cmd/Ctrl+Shift+Arrow moves the active tab regardless of focus (capture-phase)', async () => {
    const w = mountApp()
    await flushPromises()
    // Dispatched at the window in the capture phase, this must fire even though no
    // tab button is focused — the case that failed when it was a menu accelerator.
    const right = new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, shiftKey: true, cancelable: true, bubbles: true })
    const prevented = vi.spyOn(right, 'preventDefault')
    window.dispatchEvent(right)
    const left = new KeyboardEvent('keydown', { key: 'ArrowLeft', metaKey: true, shiftKey: true, cancelable: true, bubbles: true })
    window.dispatchEvent(left)
    expect(rightMoveActiveTab).toHaveBeenNthCalledWith(1, 1)
    expect(rightMoveActiveTab).toHaveBeenNthCalledWith(2, -1)
    expect(prevented).toHaveBeenCalled() // consumed, so a focused xterm never sees it
    w.unmount()
    // After unmount the listener is gone: a further chord must not call through.
    rightMoveActiveTab.mockClear()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, shiftKey: true }))
    expect(rightMoveActiveTab).not.toHaveBeenCalled()
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
  it('boots to the empty state — no composer tab is forced open', async () => {
    rightNewTab.mockClear()
    mountApp()
    await flushPromises()
    // Cold start no longer forces a composer; with nothing to restore the app
    // lands on the "no sessions yet" empty state, which a pane renders when it
    // has zero tabs. The user launches from a project in the sidebar.
    expect(rightNewTab).not.toHaveBeenCalled()
  })

  describe('splash', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())
    it('shows the splash on mount, then dismisses it after startup settles', async () => {
      const w = mountApp()
      expect(w.findComponent({ name: 'Splash' }).exists()).toBe(true)
      await flushPromises()
      // Advance past the splash's max-visible cap. (Not runAllTimers: the S8
      // subagent panel installs a recurring 1s clock interval that would make
      // runAllTimers loop forever.)
      vi.advanceTimersByTime(9000)
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

describe('App scheduled firing flow', () => {
  it('registers the scheduled-resume listener before signalling readiness', async () => {
    // Both warm channels are gated on deepLinkReady(); a schedule that comes due
    // during boot is queued in main until this listener exists, so registering it
    // late would drop the firing entirely.
    mountApp()
    await flushPromises()
    const listenOrder = (window.api.onScheduledResume as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    const readyOrder = (window.api.deepLinkReady as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    expect(listenOrder).toBeLessThan(readyOrder)
  })

  it('routes a scheduled resume to RightPanel with its seeded prompt', async () => {
    mountApp()
    await flushPromises()
    rightStartScheduledResume.mockClear()
    const resume: ScheduledResume = { conversationId: 'c1', prompt: 'continue', scheduleId: 's1', title: 'nightly' }
    scheduledResumeCb(resume)
    await flushPromises()
    // The whole payload rides through: RightPanel names the schedule back to main
    // when it cannot open the tab.
    expect(rightStartScheduledResume).toHaveBeenCalledWith(resume)
  })

  it('opens the schedules modal from the menu', async () => {
    const w = mountApp()
    await flushPromises()
    menuCb('schedules')
    await flushPromises()
    expect(w.findComponent({ name: 'SchedulesModal' }).exists()).toBe(true)
  })
})

describe('App warm CLI session flow', () => {
  it('registers the warm-session listener before signalling readiness', async () => {
    mountApp()
    await flushPromises()
    const listenOrder = (window.api.onStartupSession as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    const readyOrder = (window.api.deepLinkReady as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    expect(listenOrder).toBeLessThan(readyOrder)
  })

  it('auto-starts a new session tab (no reset, no confirm) with its prompt + ticket', async () => {
    const w = mountApp()
    await flushPromises()
    rightStartStartup.mockClear()
    startupSessionCb({ session: { mode: 'interactive', promptText: 'do the thing' }, ticket: 'SD-9' })
    await flushPromises()
    expect(rightStartStartup).toHaveBeenCalledWith({ mode: 'interactive', promptText: 'do the thing' }, 'SD-9')
    // A warm session adds a tab; it must not close existing sessions.
    expect(rightCloseAll).not.toHaveBeenCalled()
    expect(w.findComponent({ name: 'ConfirmDialog' }).exists()).toBe(false)
  })

  it('passes a ticketless warm session straight through', async () => {
    mountApp()
    await flushPromises()
    rightStartStartup.mockClear()
    startupSessionCb({ session: { mode: 'yolo', promptName: 'fix-bug' } })
    await flushPromises()
    expect(rightStartStartup).toHaveBeenCalledWith({ mode: 'yolo', promptName: 'fix-bug' }, undefined)
  })
})
