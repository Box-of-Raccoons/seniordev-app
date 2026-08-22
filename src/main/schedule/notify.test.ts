import { describe, expect, it, vi } from 'vitest'

const { state } = vi.hoisted(() => ({
  state: { supported: true, shown: [] as { title: string; body: string }[] }
}))
vi.mock('electron', () => ({
  Notification: class FakeNotification {
    private readonly opts: { title: string; body: string }
    static isSupported = (): boolean => state.supported
    constructor(opts: { title: string; body: string }) {
      this.opts = opts
    }
    show(): void {
      state.shown.push(this.opts)
    }
  }
}))

import { showScheduleNotice } from './notify'

describe('showScheduleNotice', () => {
  it('shows with correct title/body', () => {
    state.supported = true
    state.shown.length = 0
    showScheduleNotice({ title: 'Nightly sync', outcome: 'skipped', reason: 'the tab is mid-approval' })
    expect(state.shown).toEqual([{ title: 'Schedule skipped: Nightly sync', body: 'the tab is mid-approval' }])
  })

  it('no-op when unsupported', () => {
    state.supported = false
    state.shown.length = 0
    showScheduleNotice({ title: 'Nightly sync', outcome: 'failed', reason: 'the conversation it points at is gone' })
    expect(state.shown).toEqual([])
  })

  it('the injected factory bypasses Electron entirely', () => {
    const notify = vi.fn()
    showScheduleNotice({ title: 'Retry', outcome: 'missed', reason: 'the app was closed' }, notify)
    expect(notify).toHaveBeenCalledWith({ title: 'Schedule missed: Retry', body: 'the app was closed' })
  })
})
