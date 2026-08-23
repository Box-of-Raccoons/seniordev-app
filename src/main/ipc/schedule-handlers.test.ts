import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SCHEDULES } from '../../shared/ipc'
import type { Schedule, ScheduleCreate } from '../../shared/ipc'

// One shared fake ipcMain: handlers register into it and the tests invoke them
// the way the renderer would.
const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
    on: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn)
  }
}))

const { registerScheduleIpc } = await import('./schedule-handlers')
const { createSchedulesStore } = await import('../schedule/schedules-store')

const HOUR = 3600_000
const call = <T>(channel: string, ...args: unknown[]): T =>
  (handlers.get(channel) as (...a: unknown[]) => T)({} as never, ...args)

describe('schedule ipc', () => {
  let dir: string
  let sent: string[]
  let ticks: number

  function setup(): ReturnType<typeof createSchedulesStore> {
    dir = mkdtempSync(join(tmpdir(), 'sched-ipc-'))
    sent = []
    ticks = 0
    const store = createSchedulesStore({ file: join(dir, 'schedules.json'), now: () => 1000 })
    registerScheduleIpc({
      store,
      getSender: () => ({ send: (c: string) => sent.push(c) }) as never,
      runner: { tick: () => void ++ticks, start: () => {}, stop: () => {} }
    })
    return store
  }

  const spec: ScheduleCreate = {
    target: { kind: 'conversation', conversationId: 'c1' },
    prompt: 'continue',
    trigger: { kind: 'every', intervalMs: HOUR, notBeforeMs: null }
  }

  beforeEach(() => handlers.clear())
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('creates, lists, and nudges the renderer to re-read', () => {
    setup()
    const created = call<Schedule>(SCHEDULES.create, spec)
    expect(created.prompt).toBe('continue')
    expect(call<Schedule[]>(SCHEDULES.list)).toHaveLength(1)
    expect(sent).toEqual([SCHEDULES.changed])
  })

  it('evaluates immediately after a create, so a moment already here is not lost to the tick gap', () => {
    setup()
    call<Schedule>(SCHEDULES.create, spec)
    expect(ticks).toBe(1)
  })

  it('toggles enabled and removes, nudging each time', () => {
    const store = setup()
    const created = call<Schedule>(SCHEDULES.create, spec)
    call(SCHEDULES.setEnabled, created.id, false)
    expect(store.get(created.id)?.enabled).toBe(false)
    call(SCHEDULES.remove, created.id)
    expect(store.list()).toHaveLength(0)
    expect(sent).toEqual([SCHEDULES.changed, SCHEDULES.changed, SCHEDULES.changed])
  })

  it('offers no channel that fires a schedule', () => {
    // The renderer can create, read, toggle, and delete. Firing is the runner's
    // alone, so there is no way for the UI to trigger a run out of band.
    setup()
    expect([...handlers.keys()].sort()).toEqual(
      [SCHEDULES.create, SCHEDULES.list, SCHEDULES.remove, SCHEDULES.setEnabled].sort()
    )
  })
})
