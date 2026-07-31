import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import Splash from './Splash.vue'

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    getAppInfo: vi.fn().mockResolvedValue({ name: 'SeniorDev', version: '1.2.3' })
  }
})

describe('Splash', () => {
  it('renders the branded art with its natural aspect ratio declared', () => {
    const w = mount(Splash)
    const img = w.get('img.splash__art')
    expect(img.attributes('src')).toBeTruthy()
    // Natural 1344×768 declared so the box keeps the ratio — no stretch.
    expect(img.attributes('width')).toBe('1344')
    expect(img.attributes('height')).toBe('768')
    // Decorative image; the meaning rides on the container's aria-label.
    expect(img.attributes('alt')).toBe('')
  })

  it('is an accessible click-to-continue target with a visible hint', () => {
    const w = mount(Splash)
    const root = w.get('.splash')
    expect(root.attributes('role')).toBe('button')
    expect(root.attributes('tabindex')).toBe('0')
    expect(root.attributes('aria-label')).toContain('continue')
    expect(w.get('.splash__continue').text()).toBe('click to continue')
    // The old indeterminate loader is gone.
    expect(w.find('.splash__loader').exists()).toBe(false)
  })

  it('emits dismiss on click and on Enter/Escape', async () => {
    const w = mount(Splash)
    await w.get('.splash').trigger('click')
    await w.get('.splash').trigger('keydown', { key: 'Enter' })
    await w.get('.splash').trigger('keydown', { key: 'Escape' })
    expect(w.emitted('dismiss')).toHaveLength(3)
  })

  it('overlays the wordmark, version, and build-year credit on the art', async () => {
    const w = mount(Splash)
    expect(w.get('.splash__wordmark').text()).toBe('SeniorDev')
    // Version fills in from getAppInfo once it resolves.
    await flushPromises()
    expect(w.get('.splash__version').text()).toBe('version 1.2.3')
    // __BUILD_YEAR__ is frozen to '2026' under test (see vitest.config.ts).
    expect(w.get('.splash__credit').text()).toBe('Box of Raccoons LLC, 2026')
  })

  it('shows a placeholder version until app info resolves', () => {
    // Before flushPromises the getAppInfo promise is still pending.
    const w = mount(Splash)
    expect(w.get('.splash__version').text()).toBe('version …')
  })
})
