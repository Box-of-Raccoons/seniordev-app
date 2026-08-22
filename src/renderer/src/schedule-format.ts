import type { Schedule, ScheduleOutcome, ScheduleTrigger } from '../../shared/ipc'

// Turning a stored schedule into the sentences the list shows. Pure and separate
// from the component so the wording is testable: this text is the only place a
// refused firing explains itself, and getting it wrong means a schedule that
// looks like it ran when it did not.

const MIN = 60_000
const HOUR = 60 * MIN

// "every 30m", "daily at 05:00", "once, at 05:00". The trigger is the answer to
// "when does this run", so it reads as a phrase rather than a field dump.
export function describeTrigger(trigger: ScheduleTrigger): string {
  switch (trigger.kind) {
    case 'once':
      return `once, at ${clockTime(trigger.atMs)}`
    case 'every': {
      const every = `every ${describeInterval(trigger.intervalMs)}`
      return trigger.notBeforeMs === null ? every : `${every}, not before ${clockTime(trigger.notBeforeMs)}`
    }
    case 'daily':
      return `daily at ${pad(trigger.hour)}:${pad(trigger.minute)}`
  }
}

function describeInterval(ms: number): string {
  if (ms >= HOUR && ms % HOUR === 0) return `${ms / HOUR}h`
  if (ms >= MIN) return `${Math.round(ms / MIN)}m`
  return `${Math.round(ms / 1000)}s`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function clockTime(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// When the next firing is, in the terms someone glancing at a list actually
// wants: a countdown while it is close, a clock time once it is far enough away
// that counting minutes stops being useful.
export function describeNextRun(schedule: Schedule, nowMs: number): string {
  if (!schedule.enabled) return 'not scheduled'
  const delta = schedule.nextDueAt - nowMs
  if (delta <= 0) return 'due now'
  if (delta < MIN) return 'in under a minute'
  if (delta < HOUR) return `in ${Math.round(delta / MIN)}m`
  if (delta < 12 * HOUR) return `in ${Math.round(delta / HOUR)}h`
  return `at ${clockTime(schedule.nextDueAt)}`
}

// What happened last time, in a sentence that stands on its own. Never a bare
// status word: "skipped" alone leaves the reader to guess whether their session
// was touched, and the whole point of a refusal is that it explains itself.
export function describeLastRun(schedule: Schedule): string {
  const { lastOutcome, lastReason, firedCount } = schedule
  if (lastOutcome === null) return firedCount > 0 ? 'ran' : 'has not run yet'
  const reason = lastReason ? `: ${lastReason}` : ''
  switch (lastOutcome) {
    case 'fired':
      return firedCount === 1 ? 'ran once' : `ran ${firedCount} times`
    case 'deferred':
      return `waiting${reason}`
    case 'skipped':
      return `skipped${reason}`
    case 'missed':
      return `missed${reason}`
    case 'failed':
      return `stopped${reason}`
  }
}

// The glyph carries a text label everywhere it appears; this is that label, so
// state is never conveyed by colour alone (DESIGN.md, WCAG 2.1 AA).
export function outcomeLabel(outcome: ScheduleOutcome | null): string {
  switch (outcome) {
    case 'fired':
      return 'ran'
    case 'deferred':
      return 'waiting'
    case 'skipped':
      return 'skipped'
    case 'missed':
      return 'missed'
    case 'failed':
      return 'stopped'
    default:
      return 'pending'
  }
}

// A schedule that refused or failed needs the eye; one that is merely pending or
// running does not. Drives emphasis in the list, alongside (never instead of)
// the text above.
export function needsAttention(schedule: Schedule): boolean {
  return schedule.lastOutcome === 'skipped' || schedule.lastOutcome === 'failed' || schedule.lastOutcome === 'missed'
}

// What a schedule points at, for the list's second line.
export function describeTarget(schedule: Schedule, titleOf: (conversationId: string) => string | undefined): string {
  if (schedule.target.kind === 'launch') {
    const { session } = schedule.target
    const where = session.folder ?? 'no folder'
    return session.mode === 'yolo' ? `new YOLO session in ${where}` : `new session in ${where}`
  }
  return titleOf(schedule.target.conversationId) ?? 'a conversation that is no longer stored'
}
