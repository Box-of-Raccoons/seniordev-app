import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createScheduleRunner, TICK_MS, type ScheduleExecutor } from './runner'
import { DEFER_WINDOW_MS } from './scheduler'
import { createSchedulesStore, type Schedule } from './schedules-store'
import type { TabStatus } from '../../shared/ipc'

const HOUR = 3600_000

// One harness per test: a real store on a temp file (so outcomes are asserted
// through the same write path production uses) plus a recording executor.
function harness(opts: {
  clock?: number
  status?: TabStatus
  pty?: string | undefined
  conversationLive?: boolean
  resume?: { ok: true } | { ok: false; reason: string }
}) {
  const dir = mkdtempSync(join(tmpdir(), 'runner-'))
  let clock = opts.clock ?? 1000
  const injected: Array<{ ptyId: string; prompt: string }> = []
  const launched: Schedule[] = []
  const resumed: Array<{ conversationId: string; prompt: string }> = []
  const notes: Array<{ outcome: string; reason: string }> = []
  const changes: number[] = []

  const executor: ScheduleExecutor = {
    injectIntoTab: (ptyId, prompt) => void injected.push({ ptyId, prompt }),
    resumeConversation: (schedule, conversationId) => {
      resumed.push({ conversationId, prompt: schedule.prompt })
      return opts.resume ?? { ok: true }
    },
    launch: (s) => void launched.push(s)
  }

  const store = createSchedulesStore({ file: join(dir, 'schedules.json'), now: () => clock })
  const runner = createScheduleRunner({
    store,
    executor,
    ptyForConversation: () => ('pty' in opts ? opts.pty : 'pty-a'),
    statusOf: () => opts.status ?? 'idle',
    conversationIsLive: () => opts.conversationLive ?? true,
    notify: (_s, outcome, reason) => void notes.push({ outcome, reason }),
    onChanged: () => void changes.push(clock),
    now: () => clock
  })

  return {
    store,
    runner,
    injected,
    launched,
    resumed,
    notes,
    changes,
    set clock(v: number) {
      clock = v
    },
    get clock(): number {
      return clock
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  }
}

function convSchedule(h: ReturnType<typeof harness>): Schedule {
  return h.store.create({
    target: { kind: 'conversation', conversationId: 'c1' },
    prompt: 'continue',
    trigger: { kind: 'every', intervalMs: HOUR, notBeforeMs: null }
  })
}

describe('schedule runner — the fire decision', () => {
  it('injects into a live idle tab', () => {
    const h = harness({ status: 'idle' })
    const s = convSchedule(h)
    h.clock = s.nextDueAt
    h.runner.tick()
    expect(h.injected).toEqual([{ ptyId: 'pty-a', prompt: 'continue' }])
    expect(h.store.get(s.id)?.lastOutcome).toBe('fired')
    expect(h.store.get(s.id)?.firedCount).toBe(1)
    h.cleanup()
  })

  it('NEVER injects into a tab that is waiting on an approval prompt', () => {
    // The single most dangerous thing this feature could do: text written into a
    // needsYou tab lands in the confirm and its newline answers the question.
    const h = harness({ status: 'needsYou' })
    const s = convSchedule(h)
    h.clock = s.nextDueAt
    h.runner.tick()
    expect(h.injected).toEqual([])
    expect(h.store.get(s.id)?.lastOutcome).toBe('skipped')
    expect(h.store.get(s.id)?.lastReason).toMatch(/waiting on you/)
    expect(h.notes).toHaveLength(1)
    h.cleanup()
  })

  it('defers a busy tab and holds the same slot', () => {
    const h = harness({ status: 'working' })
    const s = convSchedule(h)
    // create() hands back the live stored record, so the slot is captured before
    // the tick mutates it.
    const slot = s.nextDueAt
    h.clock = slot
    h.runner.tick()
    expect(h.injected).toEqual([])
    const after = h.store.get(s.id)!
    expect(after.lastOutcome).toBe('deferred')
    expect(after.nextDueAt).toBe(slot) // same slot, retried next tick
    expect(after.deferredSinceAt).toBe(slot)
    h.cleanup()
  })

  it('fires a deferred schedule once the tab falls idle', () => {
    const h = harness({ status: 'working' })
    const s = convSchedule(h)
    h.clock = s.nextDueAt
    h.runner.tick()
    expect(h.injected).toEqual([])
    // Same harness, tab now idle.
    const h2 = harness({ status: 'idle' })
    const s2 = convSchedule(h2)
    h2.clock = s2.nextDueAt
    h2.runner.tick()
    expect(h2.injected).toHaveLength(1)
    h.cleanup()
    h2.cleanup()
  })

  it('gives up on a tab that stays busy past the defer window', () => {
    const h = harness({ status: 'working' })
    const s = convSchedule(h)
    const slot = s.nextDueAt
    h.clock = slot
    h.runner.tick() // deferred, stamped
    h.clock = slot + 31 * 60_000
    h.runner.tick()
    const after = h.store.get(s.id)!
    expect(after.lastOutcome).toBe('skipped')
    expect(after.nextDueAt).toBeGreaterThan(slot)
    h.cleanup()
  })

  it('says so when a deferral finally gives up, the one refusal that loses the run', () => {
    // advance() turns an expired deferral into a skip internally, so a gate read
    // from the runner's own pre-advance decision would stay silent here: the
    // firing is gone for good and nothing would have said it.
    const h = harness({ status: 'working' })
    const s = convSchedule(h)
    const slot = s.nextDueAt
    h.clock = slot
    h.runner.tick() // deferred: the slot is still held, so nothing to report
    expect(h.notes).toEqual([])
    h.clock = slot + DEFER_WINDOW_MS
    h.runner.tick()
    expect(h.notes).toEqual([{ outcome: 'skipped', reason: 'target stayed busy past the defer window' }])
    h.cleanup()
  })

  it('does not rewrite or re-announce a deferral that changed nothing', () => {
    // A busy target defers on every 15s tick for up to half an hour. After the
    // first, each one resolves to the state already on disk.
    const h = harness({ status: 'working' })
    const s = convSchedule(h)
    const slot = s.nextDueAt
    const record = vi.spyOn(h.store, 'recordOutcome')
    h.clock = slot
    h.runner.tick()
    expect(record).toHaveBeenCalledTimes(1) // the first deferral stamps deferredSinceAt
    expect(h.changes).toHaveLength(1)
    h.clock = slot + TICK_MS
    h.runner.tick()
    expect(record).toHaveBeenCalledTimes(1)
    expect(h.changes).toHaveLength(1)
    record.mockRestore()
    h.cleanup()
  })

  it('resumes a closed conversation rather than writing into nothing', () => {
    const h = harness({ pty: undefined })
    const s = convSchedule(h)
    h.clock = s.nextDueAt
    h.runner.tick()
    expect(h.resumed).toEqual([{ conversationId: 'c1', prompt: 'continue' }])
    expect(h.injected).toEqual([])
    expect(h.store.get(s.id)?.lastOutcome).toBe('fired')
    h.cleanup()
  })

  it('skips with the resume failure reason when the session cannot be reopened', () => {
    const h = harness({ pty: undefined, resume: { ok: false, reason: 'no transcript to resume' } })
    const s = convSchedule(h)
    h.clock = s.nextDueAt
    h.runner.tick()
    expect(h.store.get(s.id)?.lastOutcome).toBe('skipped')
    expect(h.store.get(s.id)?.lastReason).toBe('no transcript to resume')
    h.cleanup()
  })

  it('skips a tab whose process has ended', () => {
    for (const status of ['needsReview', 'failed'] as const) {
      const h = harness({ status })
      const s = convSchedule(h)
      h.clock = s.nextDueAt
      h.runner.tick()
      expect(h.injected).toEqual([])
      expect(h.store.get(s.id)?.lastReason).toMatch(/has ended/)
      h.cleanup()
    }
  })

  it('retires a schedule whose conversation is gone, instead of refusing forever', () => {
    const h = harness({ conversationLive: false })
    const s = convSchedule(h)
    h.clock = s.nextDueAt
    h.runner.tick()
    const after = h.store.get(s.id)!
    expect(after.lastOutcome).toBe('failed')
    expect(after.enabled).toBe(false)
    expect(after.lastReason).toMatch(/gone or archived/)
    h.cleanup()
  })

  it('launches a fresh session for a launch target, gated on nothing', () => {
    const h = harness({ status: 'needsYou' }) // irrelevant: no session is touched
    const s = h.store.create({
      target: { kind: 'launch', session: { mode: 'interactive', folder: '/repo' } },
      prompt: 'do the thing',
      trigger: { kind: 'every', intervalMs: HOUR, notBeforeMs: null }
    })
    h.clock = s.nextDueAt
    h.runner.tick()
    expect(h.launched.map((x) => x.id)).toEqual([s.id])
    expect(h.store.get(s.id)?.lastOutcome).toBe('fired')
    h.cleanup()
  })

  it('records a throwing executor as failed rather than dying on the tick', () => {
    const h = harness({ status: 'idle' })
    const s = convSchedule(h)
    h.clock = s.nextDueAt
    const runner = createScheduleRunner({
      store: h.store,
      executor: {
        injectIntoTab: () => {
          throw new Error('pty write failed')
        },
        resumeConversation: () => ({ ok: true }),
        launch: () => {}
      },
      ptyForConversation: () => 'pty-a',
      statusOf: () => 'idle',
      conversationIsLive: () => true,
      now: () => h.clock
    })
    expect(() => runner.tick()).not.toThrow()
    expect(h.store.get(s.id)?.lastOutcome).toBe('failed')
    expect(h.store.get(s.id)?.lastReason).toBe('pty write failed')
    expect(h.store.get(s.id)?.enabled).toBe(false) // stopOnFailure defaults on
    h.cleanup()
  })

  it('leaves a schedule alone until its slot arrives', () => {
    const h = harness({ status: 'idle' })
    convSchedule(h)
    h.runner.tick() // clock is still creation time
    expect(h.injected).toEqual([])
    h.cleanup()
  })
})

describe('schedule runner — startup and catch-up', () => {
  it('fires a slot missed while the app was down exactly once, not once per interval', () => {
    const h = harness({ status: 'idle' })
    const s = h.store.create({
      target: { kind: 'conversation', conversationId: 'c1' },
      prompt: 'continue',
      trigger: { kind: 'every', intervalMs: HOUR, notBeforeMs: null },
      catchUp: true
    })
    // Ten hours pass with the app closed.
    h.clock = s.nextDueAt + 10 * HOUR
    h.runner.tick()
    expect(h.injected).toHaveLength(1)
    // And the next slot is in the future, so a second tick does nothing.
    h.runner.tick()
    expect(h.injected).toHaveLength(1)
    h.cleanup()
  })

  it('records a miss without running it when catchUp is off', () => {
    const h = harness({ status: 'idle' })
    const s = h.store.create({
      target: { kind: 'conversation', conversationId: 'c1' },
      prompt: 'continue',
      trigger: { kind: 'every', intervalMs: HOUR, notBeforeMs: null },
      catchUp: false
    })
    h.clock = s.nextDueAt + 10 * HOUR
    h.runner.tick()
    expect(h.injected).toEqual([])
    const after = h.store.get(s.id)!
    expect(after.lastOutcome).toBe('missed')
    expect(after.enabled).toBe(true) // still scheduled, just not run late
    expect(after.nextDueAt).toBeGreaterThan(h.clock)
    h.cleanup()
  })

  it('treats a slot that just came due as due, not missed', () => {
    const h = harness({ status: 'idle' })
    const s = h.store.create({
      target: { kind: 'conversation', conversationId: 'c1' },
      prompt: 'continue',
      trigger: { kind: 'every', intervalMs: HOUR, notBeforeMs: null },
      catchUp: false
    })
    h.clock = s.nextDueAt + TICK_MS - 1
    h.runner.tick()
    expect(h.injected).toHaveLength(1)
    h.cleanup()
  })

  it('stops treating slots as missed after the first tick', () => {
    const h = harness({ status: 'idle' })
    const s = h.store.create({
      target: { kind: 'conversation', conversationId: 'c1' },
      prompt: 'continue',
      trigger: { kind: 'every', intervalMs: HOUR, notBeforeMs: null },
      catchUp: false
    })
    h.runner.tick() // startup tick, nothing due
    h.clock = s.nextDueAt + 10 * HOUR // a long gap while the app RAN (e.g. asleep)
    h.runner.tick()
    // Past startup this is a live schedule coming due late, so it runs.
    expect(h.injected).toHaveLength(1)
    h.cleanup()
  })
})

describe('schedule runner — change notification', () => {
  it('tells the UI to re-read only on a tick that resolved something', () => {
    const dir = mkdtempSync(join(tmpdir(), 'runner-'))
    let clock = 1000
    const changes: number[] = []
    const store = createSchedulesStore({ file: join(dir, 'schedules.json'), now: () => clock })
    const runner = createScheduleRunner({
      store,
      executor: { injectIntoTab: () => {}, resumeConversation: () => ({ ok: true }), launch: () => {} },
      ptyForConversation: () => 'pty-a',
      statusOf: () => 'idle',
      conversationIsLive: () => true,
      onChanged: () => void changes.push(clock),
      now: () => clock
    })
    const s = store.create({
      target: { kind: 'conversation', conversationId: 'c1' },
      prompt: 'go',
      trigger: { kind: 'every', intervalMs: HOUR, notBeforeMs: null }
    })
    runner.tick() // nothing due
    expect(changes).toEqual([])
    clock = s.nextDueAt
    runner.tick()
    expect(changes).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })

  it('passes the conversation along so delivery can pick the tool paste mode', () => {
    const h = harness({ status: 'idle' })
    const seen: string[] = []
    const s = convSchedule(h)
    const runner = createScheduleRunner({
      store: h.store,
      executor: {
        injectIntoTab: (_pty, _prompt, conversationId) => void seen.push(conversationId),
        resumeConversation: () => ({ ok: true }),
        launch: () => {}
      },
      ptyForConversation: () => 'pty-a',
      statusOf: () => 'idle',
      conversationIsLive: () => true,
      now: () => h.clock
    })
    h.clock = s.nextDueAt
    runner.tick()
    expect(seen).toEqual(['c1'])
    h.cleanup()
  })
})

describe('schedule runner — ticker', () => {
  it('ticks on the interval and stops cleanly', () => {
    vi.useFakeTimers()
    const h = harness({ status: 'idle' })
    const s = convSchedule(h)
    h.runner.start()
    expect(h.injected).toEqual([]) // startup tick: nothing due yet
    h.clock = s.nextDueAt
    vi.advanceTimersByTime(TICK_MS)
    expect(h.injected).toHaveLength(1)
    h.runner.stop()
    h.clock = s.nextDueAt + 10 * HOUR
    vi.advanceTimersByTime(10 * TICK_MS)
    expect(h.injected).toHaveLength(1) // stopped means stopped
    vi.useRealTimers()
    h.cleanup()
  })
})
