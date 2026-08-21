// Pure scheduling policy: what is due, and what a schedule looks like after a
// firing resolves. No Electron, no timers, no clock of its own — every entry
// point takes `nowMs`, so the whole of this module is driven by fake time in
// tests. The impure half (the ticker and the three delivery paths) lives in
// runner.ts, mirroring the terminal/status.ts vs terminal/status-hub.ts split.

import type { Schedule, ScheduleTrigger } from './schedules-store'

// How a firing resolved. `deferred` is the only one that does NOT advance
// nextDueAt: the target was busy, so the same slot is retried on the next tick.
export type ScheduleOutcome = 'fired' | 'deferred' | 'skipped' | 'missed' | 'failed'

// A target that never falls idle would defer forever, and a schedule that
// silently never runs is worse than one that visibly gave up. After this long
// in `deferred`, the firing is abandoned as `skipped` with a reason. A module
// constant rather than a per-schedule field: nothing yet suggests one schedule
// wants a different patience than another.
export const DEFER_WINDOW_MS = 30 * 60 * 1000

// The mutable half of a Schedule. advance() returns one of these rather than
// mutating, so the policy stays pure and the store owns persistence.
export interface ScheduleRunState {
  enabled: boolean
  firedCount: number
  nextDueAt: number
  lastFiredAt: number | null
  lastOutcome: ScheduleOutcome | null
  lastReason: string | null
  deferredSinceAt: number | null
}

// The next fire time strictly after `fromMs`, or null when the trigger has no
// further occurrence (a spent `once`). `anchorMs` is the schedule's createdAt:
// an `every` trigger with no notBefore counts intervals from when it was made.
export function nextDueAfter(trigger: ScheduleTrigger, fromMs: number, anchorMs: number): number | null {
  switch (trigger.kind) {
    case 'once':
      return trigger.atMs > fromMs ? trigger.atMs : null
    case 'every': {
      const base = Math.max(trigger.notBeforeMs ?? anchorMs, anchorMs)
      if (base > fromMs) return base
      // Skip straight to the next FUTURE slot rather than walking the intervals
      // that elapsed while the app was down. This is what keeps catch-up to a
      // single firing: ten missed intervals resolve to one slot, not ten.
      const elapsed = fromMs - base
      return base + (Math.floor(elapsed / trigger.intervalMs) + 1) * trigger.intervalMs
    }
    case 'daily':
      return nextDailyAfter(trigger.hour, trigger.minute, fromMs)
  }
}

// Local wall time, deliberately: 5am must stay 5am across a DST shift, so the
// candidate is built from local date components and rolled by a whole DAY, never
// by 86_400_000ms (which would slide the hour twice a year, on exactly the
// unattended overnight runs nobody is watching). On a spring-forward day the
// named hour may not exist; the Date constructor normalises it forward, which is
// the harmless direction (the firing happens, an hour late, once a year).
function nextDailyAfter(hour: number, minute: number, fromMs: number): number {
  const d = new Date(fromMs)
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute, 0, 0).getTime()
  if (today > fromMs) return today
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, hour, minute, 0, 0).getTime()
}

// Enabled schedules whose slot has arrived. The runner calls this once per tick.
export function dueNow(schedules: readonly Schedule[], nowMs: number): Schedule[] {
  return schedules.filter((s) => s.enabled && s.nextDueAt <= nowMs)
}

// Whether a firing that was due at `nextDueAt` was missed rather than merely
// late: the app was not running when its slot passed. The runner asks this once
// at startup; a schedule due within one tick is simply due, not missed.
export function wasMissed(schedule: Schedule, nowMs: number, tickMs: number): boolean {
  return schedule.enabled && schedule.nextDueAt <= nowMs - tickMs
}

// Fold one resolved firing into the schedule's run state. The returned state is
// complete — the store writes it wholesale rather than patching field by field.
export function advance(
  schedule: Schedule,
  outcome: ScheduleOutcome,
  reason: string | null,
  nowMs: number
): ScheduleRunState {
  // A deferral that has outstayed the window stops being a deferral. Resolving
  // this here rather than in the runner keeps every policy decision in one
  // testable place.
  if (outcome === 'deferred') {
    const since = schedule.deferredSinceAt ?? nowMs
    if (nowMs - since >= DEFER_WINDOW_MS) {
      return advance(schedule, 'skipped', 'target stayed busy past the defer window', nowMs)
    }
    return {
      enabled: schedule.enabled,
      firedCount: schedule.firedCount,
      nextDueAt: schedule.nextDueAt, // unchanged: the same slot is retried
      lastFiredAt: schedule.lastFiredAt,
      lastOutcome: 'deferred',
      lastReason: reason,
      deferredSinceAt: since
    }
  }

  const fired = outcome === 'fired'
  const firedCount = fired ? schedule.firedCount + 1 : schedule.firedCount
  const next = nextDueAfter(schedule.trigger, nowMs, schedule.createdAt)

  // Three ways a schedule retires: its trigger has no further occurrence, it has
  // fired its allowance, or it failed and was told to stop on failure.
  const spent = next === null
  const capped = schedule.maxFirings !== null && firedCount >= schedule.maxFirings
  const halted = outcome === 'failed' && schedule.stopOnFailure

  return {
    enabled: !(spent || capped || halted),
    firedCount,
    nextDueAt: next ?? schedule.nextDueAt,
    lastFiredAt: fired ? nowMs : schedule.lastFiredAt,
    lastOutcome: outcome,
    lastReason: reason,
    deferredSinceAt: null
  }
}
