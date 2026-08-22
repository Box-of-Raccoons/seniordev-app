import { advance, dueNow, wasMissed } from './scheduler'
import type { ScheduleRunState } from './scheduler'
import type { SchedulesStore } from './schedules-store'
import type { Schedule, ScheduleOutcome, TabStatus } from '../../shared/ipc'

// The impure half of scheduling: one ticker, and the dispatch from a due
// schedule to one of the three delivery paths. Every policy question it faces is
// answered by scheduler.ts; everything it can actually DO arrives as an injected
// executor, so the whole decision table below is exercised in tests with no
// Electron, no ptys, and no clock.

// A wall-clock comparison on a single interval, not one timer per schedule.
// setTimeout over hours drifts, and a schedule whose slot passed while the app
// was closed has to be noticed on the same code path as one that came due a
// second ago. 15s is well inside the smallest interval worth scheduling.
export const TICK_MS = 15_000

// What the runner can do with a due schedule. Each returns a reason on refusal
// so a skipped firing can say why in the UI rather than vanishing.
export interface ScheduleExecutor {
  // Write the prompt into a live, idle pty (main-side, via prompt delivery).
  // The conversation comes along because delivery differs per tool: codex takes a
  // bracketed paste, claude must not (the raw ESC clears its composer).
  injectIntoTab(ptyId: string, prompt: string, conversationId: string): void
  // Reopen a closed conversation with its resume id and seed the prompt. The
  // whole schedule comes along: the push crosses to the renderer, which can only
  // report a resume it failed to open by naming the schedule back.
  // Rejects with a reason when the conversation cannot be resumed.
  resumeConversation(schedule: Schedule, conversationId: string): { ok: true } | { ok: false; reason: string }
  // Start a fresh session from a stored launch spec.
  launch(schedule: Schedule): void
}

export interface RunnerDeps {
  store: SchedulesStore
  executor: ScheduleExecutor
  // The live tab running this conversation, if any.
  ptyForConversation(conversationId: string): string | undefined
  // That tab's current state.
  statusOf(ptyId: string): TabStatus | undefined
  // Whether the conversation still exists and is not archived.
  conversationIsLive(conversationId: string): boolean
  // Surfaced to the user for skipped and failed firings only; a routine `fired`
  // stays silent or a recurring schedule becomes a notification stream.
  notify?: (schedule: Schedule, outcome: ScheduleOutcome, reason: string) => void
  // Any firing at all moved the stored list, so the UI must re-read it. Called
  // once per tick that changed something, never on an idle tick and never on a
  // repeat deferral, which resolves to the state already stored.
  onChanged?: () => void
  now?: () => number
}

export interface ScheduleRunner {
  // Evaluate every schedule once. Called on the interval, and once at startup.
  tick(): void
  start(): void
  stop(): void
}

interface Resolution {
  outcome: ScheduleOutcome
  reason: string | null
}

const FIRED: Resolution = { outcome: 'fired', reason: null }

// Whether advance() produced the state the schedule already holds. Only a repeat
// deferral can: every other outcome moves nextDueAt. A busy target defers on
// every 15s tick for up to the whole defer window, and rewriting schedules.json
// and waking the UI thirty times over for identical bytes buys nothing.
function unchanged(schedule: Schedule, state: ScheduleRunState): boolean {
  return (
    state.enabled === schedule.enabled &&
    state.firedCount === schedule.firedCount &&
    state.nextDueAt === schedule.nextDueAt &&
    state.lastFiredAt === schedule.lastFiredAt &&
    state.lastOutcome === schedule.lastOutcome &&
    state.lastReason === schedule.lastReason &&
    state.deferredSinceAt === schedule.deferredSinceAt
  )
}

export function createScheduleRunner(deps: RunnerDeps): ScheduleRunner {
  const now = deps.now ?? Date.now
  let timer: ReturnType<typeof setInterval> | null = null
  // Schedules whose slot passed while the app was down are resolved once, on the
  // first tick, and never re-examined for missedness afterwards.
  let startupHandled = false

  function resolveConversation(schedule: Schedule, conversationId: string): Resolution {
    if (!deps.conversationIsLive(conversationId)) {
      // Not a skip: there is no future in which this schedule can ever run, so it
      // retires rather than reporting the same refusal every slot forever.
      return { outcome: 'failed', reason: 'the conversation it points at is gone or archived' }
    }

    const ptyId = deps.ptyForConversation(conversationId)
    if (ptyId === undefined) {
      const res = deps.executor.resumeConversation(schedule, conversationId)
      return res.ok ? FIRED : { outcome: 'skipped', reason: res.reason }
    }

    switch (deps.statusOf(ptyId)) {
      case 'idle':
        deps.executor.injectIntoTab(ptyId, schedule.prompt, conversationId)
        return FIRED
      case 'working':
        return { outcome: 'deferred', reason: 'the session was still working' }
      case 'needsYou':
        // The one refusal this feature exists to make. A needsYou tab is sitting
        // on an approval prompt: the prompt text would land in the confirm and
        // the newline after it would answer a question nobody read.
        return { outcome: 'skipped', reason: 'the session is waiting on you at a prompt' }
      default:
        // needsReview / failed / unknown: the process has exited, so there is no
        // pty to write to even though a tab may still be on screen.
        return { outcome: 'skipped', reason: 'the session has ended' }
    }
  }

  function fire(schedule: Schedule): Resolution {
    try {
      if (schedule.target.kind === 'launch') {
        deps.executor.launch(schedule)
        return FIRED
      }
      return resolveConversation(schedule, schedule.target.conversationId)
    } catch (err) {
      return { outcome: 'failed', reason: err instanceof Error ? err.message : String(err) }
    }
  }

  // Returns whether the stored record actually moved.
  function resolve(schedule: Schedule, at: number): boolean {
    // A slot that passed while the app was closed is a miss. catchUp runs it once
    // regardless of how many slots went by (nextDueAfter collapses them), which is
    // what keeps a recovery from firing ten times and draining a usage limit.
    const missed = !startupHandled && wasMissed(schedule, at, TICK_MS)
    const { outcome, reason } =
      missed && !schedule.catchUp
        ? { outcome: 'missed' as ScheduleOutcome, reason: 'the app was not running when it came due' }
        : fire(schedule)

    // advance() has the last word on the outcome: a deferral that outstayed its
    // window comes back as `skipped`. That is the one case where a busy target
    // loses the run for good, so the notify gate reads the resolved state rather
    // than the decision above, which still says `deferred`.
    const state = advance(schedule, outcome, reason, at)
    if (unchanged(schedule, state)) return false

    deps.store.recordOutcome(schedule.id, state)
    const { lastOutcome, lastReason } = state
    if ((lastOutcome === 'skipped' || lastOutcome === 'failed' || lastOutcome === 'missed') && lastReason) {
      deps.notify?.(schedule, lastOutcome, lastReason)
    }
    return true
  }

  return {
    tick() {
      const at = now()
      const due = dueNow(deps.store.list(), at)
      let changed = false
      for (const schedule of due) changed = resolve(schedule, at) || changed
      startupHandled = true
      if (changed) deps.onChanged?.()
    },
    start() {
      if (timer) return
      this.tick() // catch anything that came due while the app was closed
      timer = setInterval(() => this.tick(), TICK_MS)
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    }
  }
}
