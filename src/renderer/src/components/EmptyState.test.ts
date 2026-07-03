import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import EmptyState from './EmptyState.vue'

describe('EmptyState', () => {
  it('renders the caption text', () => {
    const w = mount(EmptyState, { props: { image: '/img/test.png', caption: 'Nothing here yet' } })
    expect(w.text()).toContain('Nothing here yet')
  })

  it('sets the img src to the passed image URL', () => {
    const w = mount(EmptyState, { props: { image: '/img/test.png', caption: 'Nothing here yet' } })
    expect(w.find('img').attributes('src')).toBe('/img/test.png')
  })

  it('sets the img alt to the empty string (decorative)', () => {
    const w = mount(EmptyState, { props: { image: '/img/test.png', caption: 'Nothing here yet' } })
    expect(w.find('img').attributes('alt')).toBe('')
  })
})
