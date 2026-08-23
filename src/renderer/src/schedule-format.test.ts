import { describe, it, expect } from 'vitest'
import {
  describeTrigger,
  describeNextRun,
  describeLastRun,
  outcomeLabel,
  needsAttention,
  describeTarget
} from './schedule-format'
import type { Schedule } from '../../shared/ipc'

const MIN = 60_000
const HOUR = 60 * MIN

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

const at = (h: number, m = 0): number => new Date(2026, 7, 21, h, m, 0, 0).getTime()

describe('describeTrigger', () => {
  it('reads as a phrase for each kind', () => {
    expect(describeTrigger({ kind: 'daily', hour: 5, minute: 0 })).toBe('daily at 05:00')
    expect(describeTrigger({ kind: 'every', intervalMs: 30 * MIN, notBeforeMs: null })).toBe('every 30m')
    expect(describeTrigger({ kind: 'every', intervalMs: 2 * HOUR, notBeforeMs: null })).toBe('every 2h')
    expect(describeTrigger({ kind: 'once', atMs: at(5, 30) })).toBe('once, at 05:30')
  })

  it('says when an interval cannot start yet', () => {
    expect(describeTrigger({ kind: 'every', intervalMs: 30 * MIN, notBeforeMs: at(5) })).toBe(
      'every 30m, not before 05:00'
    )
  })
})

describe('describeNextRun', () => {
  it('counts down while close and switches to a clock time when far', () => {
    const now = at(1)
    expect(describeNextRun(schedule({ nextDueAt: now + 30_000 }), now)).toBe('in under a minute')
    expect(describeNextRun(schedule({ nextDueAt: now + 20 * MIN }), now)).toBe('in 20m')
    expect(describeNextRun(schedule({ nextDueAt: now + 4 * HOUR }), now)).toBe('in 4h')
    expect(describeNextRun(schedule({ nextDueAt: at(20) }), now)).toMatch(/^at \d\d:\d\d$/)
  })

  it('names the day once a clock time alone would be ambiguous', () => {
    // "at 05:00" of WHICH day: an every-30m schedule gated behind a not-before
    // can sit more than a day out, and the list read as if it ran this morning.
    const now = at(1)
    expect(describeNextRun(schedule({ nextDueAt: at(5) + 24 * HOUR }), now)).toMatch(/^on .+ at 05:00$/)
  })

  it('says due now for a slot already reached, and nothing for a disabled schedule', () => {
    const now = at(1)
    expect(describeNextRun(schedule({ nextDueAt: now }), now)).toBe('due now')
    expect(describeNextRun(schedule({ nextDueAt: now + HOUR, enabled: false }), now)).toBe('not scheduled')
  })
})

describe('describeLastRun', () => {
  it('always carries the reason a firing refused, never a bare status word', () => {
    // "skipped" alone leaves the reader guessing whether their session was
    // touched; the refusal has to explain itself.
    expect(describeLastRun(schedule({ lastOutcome: 'skipped', lastReason: 'the session is waiting on you at a prompt' })))
      .toBe('skipped: the session is waiting on you at a prompt')
    expect(describeLastRun(schedule({ lastOutcome: 'failed', lastReason: 'pty write failed' })))
      .toBe('stopped: pty write failed')
    expect(describeLastRun(schedule({ lastOutcome: 'missed', lastReason: 'the app was not running when it came due' })))
      .toBe('missed: the app was not running when it came due')
  })

  it('counts successful runs', () => {
    expect(describeLastRun(schedule({ lastOutcome: 'fired', firedCount: 1 }))).toBe('ran once')
    expect(describeLastRun(schedule({ lastOutcome: 'fired', firedCount: 4 }))).toBe('ran 4 times')
    expect(describeLastRun(schedule())).toBe('has not run yet')
  })
})

describe('outcomeLabel and needsAttention', () => {
  it('gives every state a word, so nothing is signalled by colour alone', () => {
    expect(outcomeLabel(null)).toBe('pending')
    for (const o of ['fired', 'deferred', 'skipped', 'missed', 'failed'] as const) {
      expect(outcomeLabel(o)).not.toBe('')
    }
  })

  it('flags only the outcomes that need the eye', () => {
    expect(needsAttention(schedule({ lastOutcome: 'skipped' }))).toBe(true)
    expect(needsAttention(schedule({ lastOutcome: 'failed' }))).toBe(true)
    expect(needsAttention(schedule({ lastOutcome: 'missed' }))).toBe(true)
    expect(needsAttention(schedule({ lastOutcome: 'fired' }))).toBe(false)
    expect(needsAttention(schedule({ lastOutcome: 'deferred' }))).toBe(false)
  })
})

describe('describeTarget', () => {
  it('names the conversation, and says plainly when it is gone', () => {
    const titles = (id: string): string | undefined => (id === 'c1' ? 'GG-14 login fix' : undefined)
    expect(describeTarget(schedule(), titles)).toBe('GG-14 login fix')
    expect(describeTarget(schedule({ target: { kind: 'conversation', conversationId: 'x' } }), titles)).toMatch(
      /no longer stored/
    )
  })

  it('calls out a YOLO launch explicitly', () => {
    // A recurring YOLO launch is the highest-consequence thing this can hold; the
    // list must not describe it the same way as an interactive one.
    const yolo = schedule({ target: { kind: 'launch', session: { mode: 'yolo', folder: '/repo' } } })
    expect(describeTarget(yolo, () => undefined)).toBe('new YOLO session in /repo')
    const interactive = schedule({ target: { kind: 'launch', session: { mode: 'interactive', folder: '/repo' } } })
    expect(describeTarget(interactive, () => undefined)).toBe('new session in /repo')
  })
})
