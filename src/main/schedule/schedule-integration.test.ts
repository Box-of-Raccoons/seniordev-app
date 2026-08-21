import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSchedulesStore } from './schedules-store'
import { createScheduleRunner } from './runner'
import { createPromptDelivery, SUBMIT_DELAY_MS } from '../terminal/prompt-delivery'
import { createSessionActivity } from '../terminal/activity'
import type { TabStatus } from '../../shared/ipc'

// Everything real except the pty and the clock: a store on a real file, the real
// runner, the real prompt delivery over the real activity tracker. The unit
// tests each prove one piece; this proves they are wired to each other, which is
// where a scheduled firing would otherwise die silently between layers.

function wire(status: () => TabStatus) {
  const dir = mkdtempSync(join(tmpdir(), 'sched-int-'))
  const file = join(dir, 'schedules.json')
  let clock = 1000
  const writes: string[] = []
  const activity = createSessionActivity()
  const delivery = createPromptDelivery({ write: (_id, data) => writes.push(data), activity })
  const store = createSchedulesStore({ file, now: () => clock })
  const runner = createScheduleRunner({
    store,
    executor: {
      injectIntoTab: (ptyId, prompt) => delivery.deliverNow(ptyId, prompt, false),
      resumeConversation: () => ({ ok: true }),
      launch: () => {}
    },
    ptyForConversation: () => 'pty-a',
    statusOf: status,
    conversationIsLive: () => true,
    now: () => clock
  })
  return {
    store,
    runner,
    writes,
    file,
    set clock(v: number) {
      clock = v
    },
    get clock(): number {
      return clock
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  }
}

afterEach(() => vi.useRealTimers())

describe('schedule → delivery, end to end', () => {
  it('carries a due schedule all the way to bytes on the wire', () => {
    vi.useFakeTimers()
    const w = wire(() => 'idle')
    const s = w.store.create({
      target: { kind: 'conversation', conversationId: 'c1' },
      prompt: 'continue',
      trigger: { kind: 'once', atMs: 1000 + 3600_000 }
    })
    w.clock = s.nextDueAt
    w.runner.tick()
    // The prompt goes out at once (the hub already said idle), the Enter follows
    // as its own keystroke a beat later.
    expect(w.writes).toEqual(['continue'])
    vi.advanceTimersByTime(SUBMIT_DELAY_MS)
    expect(w.writes).toEqual(['continue', '\r'])
  })

  it('persists the firing to disk, so a restart does not run it again', () => {
    vi.useFakeTimers()
    const w = wire(() => 'idle')
    const s = w.store.create({
      target: { kind: 'conversation', conversationId: 'c1' },
      prompt: 'continue',
      trigger: { kind: 'once', atMs: 1000 + 3600_000 }
    })
    w.clock = s.nextDueAt
    w.runner.tick()
    w.store.flush()

    const onDisk = JSON.parse(readFileSync(w.file, 'utf8')).schedules[0]
    expect(onDisk.lastOutcome).toBe('fired')
    expect(onDisk.firedCount).toBe(1)
    expect(onDisk.enabled).toBe(false) // a spent one-shot retires itself

    // A fresh store over the same file agrees, and the runner finds nothing due.
    const reloaded = createSchedulesStore({ file: w.file, now: () => w.clock })
    expect(reloaded.list()[0].enabled).toBe(false)
    w.cleanup()
  })

  it('writes NOTHING when the session is at an approval prompt', () => {
    // The end-to-end version of the gate: not merely "the runner decided to
    // skip", but that no byte reached the wire.
    vi.useFakeTimers()
    const w = wire(() => 'needsYou')
    const s = w.store.create({
      target: { kind: 'conversation', conversationId: 'c1' },
      prompt: 'this must not be typed into a confirm',
      trigger: { kind: 'once', atMs: 1000 + 3600_000 }
    })
    w.clock = s.nextDueAt
    w.runner.tick()
    vi.advanceTimersByTime(60_000)
    expect(w.writes).toEqual([])
    expect(w.store.get(s.id)?.lastReason).toMatch(/waiting on you/)
    w.cleanup()
  })

  it('holds its slot while the session is busy, then delivers once it frees up', () => {
    vi.useFakeTimers()
    let status: TabStatus = 'working'
    const w = wire(() => status)
    const s = w.store.create({
      target: { kind: 'conversation', conversationId: 'c1' },
      prompt: 'continue',
      trigger: { kind: 'once', atMs: 1000 + 3600_000 }
    })
    const slot = s.nextDueAt
    w.clock = slot
    w.runner.tick()
    expect(w.writes).toEqual([])
    expect(w.store.get(s.id)?.nextDueAt).toBe(slot) // slot held

    status = 'idle'
    w.clock = slot + 15_000
    w.runner.tick()
    expect(w.writes).toEqual(['continue'])
    w.cleanup()
  })
})
