import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import StatusGlyph from './StatusGlyph.vue'

describe('StatusGlyph', () => {
  it('renders nothing when there is no status (composer / no live tab)', () => {
    const w = mount(StatusGlyph, { props: { status: null } })
    expect(w.find('.status-glyph').exists()).toBe(false)
    expect(w.find('svg').exists()).toBe(false)
  })

  it('labels every state for assistive tech (state is never colour-only)', () => {
    const cases: Array<['working' | 'idle' | 'needsYou' | 'needsReview' | 'failed', string]> = [
      ['working', 'working'],
      ['idle', 'idle'],
      ['needsYou', 'needs you'],
      ['needsReview', 'needs review'],
      ['failed', 'failed']
    ]
    for (const [status, label] of cases) {
      const w = mount(StatusGlyph, { props: { status } })
      const glyph = w.find('.status-glyph')
      expect(glyph.attributes('role')).toBe('img')
      expect(glyph.attributes('aria-label')).toBe(label)
    }
  })

  it('working is a solid amber circle that pulses (its fill animates)', () => {
    const w = mount(StatusGlyph, { props: { status: 'working' } })
    const c = w.find('circle.work-pulse')
    expect(c.exists()).toBe(true)
    expect(c.attributes('fill')).toBe('var(--amber)')
    // not a hollow ring
    expect(c.attributes('stroke')).toBeUndefined()
  })

  it('idle is a hollow ink-muted ring (distinct from working by fill, not colour)', () => {
    const w = mount(StatusGlyph, { props: { status: 'idle' } })
    const c = w.find('circle')
    expect(c.attributes('fill')).toBe('none')
    expect(c.attributes('stroke')).toBe('var(--ink-muted)')
    // no pulse on idle
    expect(w.find('.work-pulse').exists()).toBe(false)
  })

  it('needsYou is a bouncing triangle with a static heavier fallback for reduced motion', () => {
    const w = mount(StatusGlyph, { props: { status: 'needsYou' } })
    // animated variant
    expect(w.find('path.bounce').exists()).toBe(true)
    // reduced-motion variant present (CSS decides which shows)
    expect(w.find('.rm-only').exists()).toBe(true)
    expect(w.findAll('path').every((p) => p.attributes('fill') === 'var(--amber)' || p.attributes('stroke') === 'var(--amber)')).toBe(true)
  })

  it('needsReview is a green diamond', () => {
    const w = mount(StatusGlyph, { props: { status: 'needsReview' } })
    const p = w.find('path')
    expect(p.attributes('fill')).toBe('var(--green)')
    expect(p.attributes('d')).toBe('M8 2 L14 8 L8 14 L2 8 Z') // diamond
  })

  it('failed is a rust cross', () => {
    const w = mount(StatusGlyph, { props: { status: 'failed' } })
    const p = w.find('path')
    expect(p.attributes('stroke')).toBe('var(--rust)')
    expect(p.find).toBeDefined()
    expect(w.find('path').attributes('d')).toContain('M4.5 4.5 L11.5 11.5') // an X
  })

  it('each state renders a distinct shape (no two the same)', () => {
    const shapeKey = (status: 'working' | 'idle' | 'needsYou' | 'needsReview' | 'failed'): string => {
      const w = mount(StatusGlyph, { props: { status } })
      // signature = tag + fill/stroke + first path d (enough to separate all five)
      const circle = w.find('circle')
      if (circle.exists()) return `circle:${circle.attributes('fill')}:${circle.attributes('stroke') ?? ''}`
      const path = w.find('path')
      return `path:${path.attributes('d')}`
    }
    const keys = (['working', 'idle', 'needsYou', 'needsReview', 'failed'] as const).map(shapeKey)
    expect(new Set(keys).size).toBe(5)
  })
})
