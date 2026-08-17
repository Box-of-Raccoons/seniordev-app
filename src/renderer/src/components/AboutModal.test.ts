// src/renderer/src/components/AboutModal.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AboutModal from './AboutModal.vue'

let updateCb: ((e: unknown) => void) | null = null
const checkForUpdate = vi.fn()

function setApi(status: unknown): void {
  ;(window as unknown as { api: unknown }).api = {
    getAppInfo: vi.fn().mockResolvedValue({ name: 'SeniorDev', version: '1.2.3' }),
    getUpdateStatus: vi.fn().mockResolvedValue(status),
    checkForUpdate,
    installUpdate: vi.fn(),
    onUpdateStatus: (cb: (e: unknown) => void) => {
      updateCb = cb
      return () => { updateCb = null }
    }
  }
}

beforeEach(() => {
  updateCb = null
  checkForUpdate.mockReset()
  setApi({ state: 'idle', supported: true })
})

describe('AboutModal', () => {
  it('shows the mascot, name, version, and the credit line', async () => {
    const w = mount(AboutModal)
    await flushPromises()
    expect(w.get('img.about__mascot').attributes('src')).toBeTruthy()
    expect(w.text()).toContain('SeniorDev')
    expect(w.text()).toContain('v1.2.3')
    expect(w.text()).toContain('By Box of Raccoons LLC, 2026')
  })
  it('OK and Escape emit close', async () => {
    const w = mount(AboutModal)
    await flushPromises()
    await w.get('button.about-ok').trigger('click')
    expect(w.emitted('close')).toBeTruthy()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('close')!.length).toBeGreaterThanOrEqual(2)
  })
})

describe('AboutModal update status', () => {
  it('says it is up to date, and offers a manual check', async () => {
    const w = mount(AboutModal)
    await flushPromises()
    expect(w.text()).toContain('SeniorDev is up to date')
    await w.get('button.about-secondary').trigger('click')
    expect(checkForUpdate).toHaveBeenCalledTimes(1)
  })

  it('follows live progress pushed while the modal is open', async () => {
    const w = mount(AboutModal)
    await flushPromises()
    updateCb!({ state: 'downloading', version: '0.6.0', percent: 62, supported: true })
    await flushPromises()
    expect(w.text()).toContain('Downloading v0.6.0… 62%')
    // No check button mid-download: the action isn't available, so it isn't shown.
    expect(w.findAll('button.about-secondary')).toHaveLength(0)
  })

  it('offers the restart only once an update is staged, and says it installs on quit', async () => {
    setApi({ state: 'ready', version: '0.6.0', supported: true })
    const w = mount(AboutModal)
    await flushPromises()
    expect(w.text()).toContain('v0.6.0 is ready')
    expect(w.text()).toContain('installs when you quit')

    const buttons = w.findAll('button.about-secondary')
    expect(buttons).toHaveLength(1) // the restart, not a redundant re-check
    await buttons[0].trigger('click')
    // The modal only requests it; App owns the confirm and the IPC call.
    expect(w.emitted('install')).toBeTruthy()
  })

  it('reports a failed check as text, not as a color alone', async () => {
    setApi({ state: 'error', message: 'ENOTFOUND github.com', supported: true })
    const w = mount(AboutModal)
    await flushPromises()
    expect(w.text()).toContain('Update check failed: ENOTFOUND github.com')
  })

  it('explains itself instead of showing a dead button when running from source', async () => {
    setApi({ state: 'idle', supported: false })
    const w = mount(AboutModal)
    await flushPromises()
    expect(w.text()).toContain('runs from source')
    expect(w.findAll('button.about-secondary')).toHaveLength(0)
  })
})
