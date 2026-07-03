// src/renderer/src/components/AboutModal.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AboutModal from './AboutModal.vue'

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    getAppInfo: vi.fn().mockResolvedValue({ name: 'SeniorDev', version: '1.2.3' })
  }
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
