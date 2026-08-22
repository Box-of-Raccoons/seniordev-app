import { describe, it, expect } from 'vitest'
import { advance, dueNow, nextDueAfter, wasMissed, DEFER_WINDOW_MS } from './scheduler'
import type { Schedule, ScheduleTrigger } from './schedules-store'

const HOUR = 3600_000
const DAY = 24 * HOUR

function schedule(over: Partial<Schedule> = {}): Schedule {
  return {
    id: 's1',
    enabled: true,
    title: 'continue',
    target: { kind: 'conversation', conversationId: 'c1' },
    prompt: 'continue',
    trigger: { kind: 'every', intervalMs: HOUR, notBeforeMs: null },
    catchUp: false,
    maxFirings: 10,
    stopOnFailure: true,
    firedCount: 0,
    nextDueAt: 0,
    lastFiredAt: null,
    lastOutcome: null,
    lastReason: null,
    deferredSinceAt: null,
    createdAt: 0,
    ...over
  }
}

// Builds a local-time timestamp, so the daily tests assert on wall time in
// whatever zone the suite happens to run in rather than hardcoding an offset.
function local(y: number, m: number, d: number, h: number, min = 0): number {
  return new Date(y, m - 1, d, h, min, 0, 0).getTime()
}

describe('nextDueAfter', () => {
  it('returns a once trigger still in the future, and null once it is spent', () => {
    const t: ScheduleTrigger = { kind: 'once', atMs: 5000 }
    expect(nextDueAfter(t, 4000, 0)).toBe(5000)
    expect(nextDueAfter(t, 5000, 0)).toBeNull()
    expect(nextDueAfter(t, 6000, 0)).toBeNull()
  })

  it('counts every-intervals from createdAt when no notBefore is set', () => {
    const t: ScheduleTrigger = { kind: 'every', intervalMs: 1000, notBeforeMs: null }
    expect(nextDueAfter(t, 0, 0)).toBe(1000)
    expect(nextDueAfter(t, 1500, 0)).toBe(2000)
  })

  it('treats notBefore as an earliest-start, not a fire-at', () => {
    const t: ScheduleTrigger = { kind: 'every', intervalMs: HOUR, notBeforeMs: 10 * HOUR }
    // Before the window opens, the next slot IS the window opening.
    expect(nextDueAfter(t, 2 * HOUR, 0)).toBe(10 * HOUR)
    // After it opens, the interval runs normally from it.
    expect(nextDueAfter(t, 10 * HOUR, 0)).toBe(11 * HOUR)
  })

  it('skips to the next future slot rather than walking every missed interval', () => {
    const t: ScheduleTrigger = { kind: 'every', intervalMs: HOUR, notBeforeMs: null }
    // Ten hours of downtime resolves to ONE next slot, which is what keeps
    // catch-up to a single firing instead of a burst of ten.
    expect(nextDueAfter(t, 10 * HOUR + 5, 0)).toBe(11 * HOUR)
  })

  it('rolls a daily trigger to tomorrow once today has passed', () => {
    const t: ScheduleTrigger = { kind: 'daily', hour: 5, minute: 0 }
    expect(nextDueAfter(t, local(2026, 8, 21, 1), 0)).toBe(local(2026, 8, 21, 5))
    expect(nextDueAfter(t, local(2026, 8, 21, 5), 0)).toBe(local(2026, 8, 22, 5))
    expect(nextDueAfter(t, local(2026, 8, 21, 9), 0)).toBe(local(2026, 8, 22, 5))
  })

  it('keeps a daily trigger on its wall-clock hour across a DST boundary', () => {
    // US DST ends 2026-11-01. A naive +86_400_000 would land 04:00 the next day;
    // holding the hour is the whole reason daily stores hour/minute.
    const t: ScheduleTrigger = { kind: 'daily', hour: 5, minute: 0 }
    const next = nextDueAfter(t, local(2026, 10, 31, 6), 0)
    expect(next).toBe(local(2026, 11, 1, 5))
    expect(new Date(next as number).getHours()).toBe(5)
  })

  it('rolls a daily trigger across a month boundary', () => {
    const t: ScheduleTrigger = { kind: 'daily', hour: 5, minute: 30 }
    expect(nextDueAfter(t, local(2026, 8, 31, 9), 0)).toBe(local(2026, 9, 1, 5, 30))
  })
})

describe('dueNow', () => {
  it('returns only enabled schedules whose slot has arrived', () => {
    const a = schedule({ id: 'a', nextDueAt: 500 })
    const b = schedule({ id: 'b', nextDueAt: 5000 })
    const c = schedule({ id: 'c', nextDueAt: 500, enabled: false })
    expect(dueNow([a, b, c], 1000).map((s) => s.id)).toEqual(['a'])
  })
})

describe('wasMissed', () => {
  it('distinguishes a slot that passed while the app was down from one merely due', () => {
    const s = schedule({ nextDueAt: 1000 })
    expect(wasMissed(s, 1000, 15_000)).toBe(false) // due right now
    expect(wasMissed(s, 60_000, 15_000)).toBe(true) // long gone
  })
})

describe('advance', () => {
  it('counts a firing and moves to the next slot', () => {
    const s = schedule({ nextDueAt: HOUR })
    const next = advance(s, 'fired', null, HOUR)
    expect(next.firedCount).toBe(1)
    expect(next.lastFiredAt).toBe(HOUR)
    expect(next.nextDueAt).toBe(2 * HOUR)
    expect(next.enabled).toBe(true)
  })

  it('retires a schedule once it hits maxFirings', () => {
    const s = schedule({ firedCount: 9, maxFirings: 10 })
    expect(advance(s, 'fired', null, HOUR).enabled).toBe(false)
  })

  it('retires a spent once trigger after it fires', () => {
    const s = schedule({ trigger: { kind: 'once', atMs: HOUR }, maxFirings: null, nextDueAt: HOUR })
    const next = advance(s, 'fired', null, HOUR)
    expect(next.enabled).toBe(false)
    expect(next.firedCount).toBe(1)
  })

  it('disables on failure when stopOnFailure is set, and keeps going when it is not', () => {
    const stop = schedule({ stopOnFailure: true })
    expect(advance(stop, 'failed', 'boom', HOUR).enabled).toBe(false)
    const carry = schedule({ stopOnFailure: false })
    const next = advance(carry, 'failed', 'boom', HOUR)
    expect(next.enabled).toBe(true)
    expect(next.lastReason).toBe('boom')
  })

  it('advances past a skipped or missed slot without counting it as a firing', () => {
    const s = schedule({ nextDueAt: HOUR })
    for (const outcome of ['skipped', 'missed'] as const) {
      const next = advance(s, outcome, 'busy', HOUR)
      expect(next.firedCount).toBe(0)
      expect(next.lastFiredAt).toBeNull()
      expect(next.nextDueAt).toBe(2 * HOUR)
      expect(next.lastOutcome).toBe(outcome)
    }
  })

  it('holds the same slot while deferring, and stamps when the deferral began', () => {
    const s = schedule({ nextDueAt: HOUR })
    const next = advance(s, 'deferred', 'target busy', HOUR)
    expect(next.nextDueAt).toBe(HOUR) // unchanged: retried next tick
    expect(next.deferredSinceAt).toBe(HOUR)
    expect(next.enabled).toBe(true)
  })

  it('gives up on a deferral that outstays the window, rather than deferring forever', () => {
    const s = schedule({ nextDueAt: HOUR, deferredSinceAt: HOUR })
    const at = HOUR + DEFER_WINDOW_MS
    const next = advance(s, 'deferred', 'target busy', at)
    expect(next.lastOutcome).toBe('skipped')
    expect(next.lastReason).toMatch(/defer window/)
    expect(next.nextDueAt).toBeGreaterThan(HOUR) // moved on to the next slot
    expect(next.deferredSinceAt).toBeNull()
  })

  it('clears the deferral stamp once the firing resolves', () => {
    const s = schedule({ deferredSinceAt: HOUR })
    expect(advance(s, 'fired', null, HOUR + 1000).deferredSinceAt).toBeNull()
  })
})
