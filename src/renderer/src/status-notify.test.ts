import { describe, it, expect } from 'vitest'
import { shouldNotify, notificationText } from './status-notify'
import type { TabStatus } from '../../shared/ipc'

// A background tab (not active) with the window focused — the case that should notify.
const BG = { active: false, win: true }

describe('shouldNotify', () => {
  it('fires entering needsYou or needsReview on a background tab', () => {
    expect(shouldNotify('working', 'needsYou', BG.active, BG.win)).toBe(true)
    expect(shouldNotify('working', 'needsReview', BG.active, BG.win)).toBe(true)
    expect(shouldNotify('idle', 'needsYou', BG.active, BG.win)).toBe(true)
  })

  it('does not fire for non-attention states', () => {
    for (const s of ['working', 'idle', 'failed'] as TabStatus[]) {
      expect(shouldNotify('needsYou', s, false, true)).toBe(false)
    }
  })

  it('does not re-fire without an intervening transition (same state)', () => {
    expect(shouldNotify('needsYou', 'needsYou', false, true)).toBe(false)
    expect(shouldNotify('needsReview', 'needsReview', false, true)).toBe(false)
  })

  it('suppresses when the tab is active AND the window is focused (you are looking at it)', () => {
    expect(shouldNotify('working', 'needsYou', true, true)).toBe(false)
  })

  it('still fires if the tab is active but the window is NOT focused', () => {
    expect(shouldNotify('working', 'needsYou', true, false)).toBe(true)
  })

  it('still fires if the window is focused but the tab is NOT active', () => {
    expect(shouldNotify('working', 'needsYou', false, true)).toBe(true)
  })

  it('fires on the first-seen transition (prev undefined) into an attention state', () => {
    expect(shouldNotify(undefined, 'needsReview', false, true)).toBe(true)
  })
})

describe('notificationText', () => {
  it('reads for needsYou and needsReview, carrying the tab title as the body', () => {
    expect(notificationText('needsYou', 'orchestrator · GT-418')).toEqual({
      heading: 'Needs your input',
      body: 'orchestrator · GT-418'
    })
    expect(notificationText('needsReview', 'yolo · deploy')).toEqual({
      heading: 'Ready for review',
      body: 'yolo · deploy'
    })
  })
})
