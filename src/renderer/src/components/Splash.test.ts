import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import Splash from './Splash.vue'

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

  it('exposes an accessible loading status', () => {
    const root = mount(Splash).get('.splash')
    expect(root.attributes('role')).toBe('status')
    expect(root.attributes('aria-label')).toContain('starting')
  })
})
