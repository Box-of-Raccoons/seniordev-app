import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSplash } from './useSplash'

// Fake timers mock Date too, so the composable's Date.now()-based clock advances
// in lockstep with the scheduled setTimeouts.
describe('useSplash', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('starts visible (the splash is part of the first paint)', () => {
    expect(useSplash().visible.value).toBe(true)
  })

  it('ready() before the minimum keeps the splash up until the remainder elapses', () => {
    const s = useSplash({ minVisibleMs: 600, maxVisibleMs: 8000 })
    vi.advanceTimersByTime(200)
    s.ready() // 400ms of the minimum still owed
    expect(s.visible.value).toBe(true)
    vi.advanceTimersByTime(399)
    expect(s.visible.value).toBe(true)
    vi.advanceTimersByTime(1)
    expect(s.visible.value).toBe(false)
  })

  it('ready() after the minimum dismisses immediately', () => {
    const s = useSplash({ minVisibleMs: 600 })
    vi.advanceTimersByTime(600)
    s.ready()
    expect(s.visible.value).toBe(false)
  })

  it('the max cap dismisses even if ready() never fires (hung startup)', () => {
    const s = useSplash({ minVisibleMs: 600, maxVisibleMs: 8000 })
    vi.advanceTimersByTime(7999)
    expect(s.visible.value).toBe(true)
    vi.advanceTimersByTime(1)
    expect(s.visible.value).toBe(false)
  })

  it('ready() is idempotent and a no-op once hidden', () => {
    const s = useSplash({ minVisibleMs: 100 })
    vi.advanceTimersByTime(100)
    s.ready()
    expect(s.visible.value).toBe(false)
    s.ready() // must not throw or resurrect the splash
    expect(s.visible.value).toBe(false)
  })

  it('repeated ready() before the minimum still dismisses exactly once, on time', () => {
    const s = useSplash({ minVisibleMs: 600 })
    vi.advanceTimersByTime(100)
    s.ready()
    s.ready() // second call must not reschedule or double-fire
    vi.advanceTimersByTime(499)
    expect(s.visible.value).toBe(true)
    vi.advanceTimersByTime(1)
    expect(s.visible.value).toBe(false)
  })
})
