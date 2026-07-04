// src/renderer/src/composables/useResizableSplit.test.ts
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { clampLeftWidth, useResizableSplit, DEFAULTS } from './useResizableSplit'

describe('clampLeftWidth', () => {
  const container = 1000
  const { minLeft, minRight, dividerWidth } = DEFAULTS

  it('returns the desired width when it fits within both minimums', () => {
    expect(clampLeftWidth(500, container, minLeft, minRight, dividerWidth)).toBe(500)
  })

  it('stops at the left minimum instead of collapsing the left panel', () => {
    expect(clampLeftWidth(100, container, minLeft, minRight, dividerWidth)).toBe(minLeft)
  })

  it('stops at the right minimum instead of collapsing the right panel', () => {
    // max left = 1000 - 6 - 320 = 674
    expect(clampLeftWidth(900, container, minLeft, minRight, dividerWidth)).toBe(674)
  })

  it('pins to the left minimum when the container is too narrow for both', () => {
    // 700 - 6 - 320 = 374 max, still > 320 so both fit; use a genuinely tight one
    const tight = 600 // max = 600 - 6 - 320 = 274 < 320 minLeft
    expect(clampLeftWidth(500, tight, minLeft, minRight, dividerWidth)).toBe(minLeft)
  })

  it('never exceeds what the container can physically hold when extremely narrow', () => {
    // container smaller than minLeft itself
    expect(clampLeftWidth(500, 200, minLeft, minRight, dividerWidth)).toBe(200 - dividerWidth)
  })
})

describe('useResizableSplit', () => {
  function withContainer(width: number) {
    const el = document.createElement('div')
    el.getBoundingClientRect = () =>
      ({ width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    return ref<HTMLElement | null>(el)
  }

  it('defaults to an even flex split before any interaction', () => {
    const { leftStyle, leftWidth, leftPercent } = useResizableSplit(withContainer(1000))
    expect(leftWidth.value).toBeNull()
    expect(leftStyle.value).toEqual({ flex: '1 1 0' })
    expect(leftPercent.value).toBe(50)
  })

  it('pins the left panel to a px width once nudged, clamped to the minimum', () => {
    const container = withContainer(1000)
    const { onKeydown, leftStyle, leftWidth } = useResizableSplit(container)
    // Even split on 1000px container is 497px; one ArrowLeft nudges by step (24).
    const before = (1000 - DEFAULTS.dividerWidth) / 2
    onKeydown(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    expect(leftWidth.value).toBe(before - DEFAULTS.step)
    expect(leftStyle.value).toEqual({ flex: `0 0 ${before - DEFAULTS.step}px` })
  })

  it('ArrowRight grows the left panel but clamps at the right minimum', () => {
    const container = withContainer(1000)
    const { onKeydown, leftWidth, setLeft } = useResizableSplit(container)
    setLeft(670) // near the 674 max
    onKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' })) // +24 → 694, clamps to 674
    expect(leftWidth.value).toBe(674)
  })
})
