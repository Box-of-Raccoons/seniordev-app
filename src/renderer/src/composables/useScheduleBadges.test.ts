import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { useScheduleBadges } from './useScheduleBadges'
import type { Schedule } from '../../../shared/ipc'

const HOUR = 3600_000

function schedule(over: Partial<Schedule> = {}): Schedule {
  return {
    id: 's1',
    enabled: true,
    title: 'nightly sweep',
    target: { kind: 'conversation', conversationId: 'c1' },
    prompt: 'go',
    trigger: { kind: 'daily', hour: 5, minute: 0 },
    catchUp: false,
    maxFirings: 10,
    stopOnFailure: true,
    firedCount: 0,
    nextDueAt: Date.now() + HOUR,
    lastFiredAt: null,
    lastOutcome: null,
    lastReason: null,
    deferredSinceAt: null,
    createdAt: 0,
    ...over
  }
}

let listSchedules: ReturnType<typeof vi.fn>
let onSchedulesChanged: ReturnType<typeof vi.fn>
let changedCb: () => void

beforeEach(() => {
  listSchedules = vi.fn().mockResolvedValue([])
  onSchedulesChanged = vi.fn((cb) => {
    changedCb = cb
    return () => {}
  })
  ;(window as unknown as { api: unknown }).api = { listSchedules, onSchedulesChanged }
})
afterEach(() => vi.useRealTimers())

describe('useScheduleBadges', () => {
  it('finds the schedule aimed at a conversation, and nothing for an unscheduled one', async () => {
    listSchedules.mockResolvedValue([schedule()])
    const b = useScheduleBadges()
    b.start()
    await flushPromises()
    expect(b.soonestFor('c1')?.title).toBe('nightly sweep')
    expect(b.soonestFor('c2')).toBeNull()
    b.stop()
  })

  it('picks the soonest when a conversation has several', async () => {
    listSchedules.mockResolvedValue([
      schedule({ id: 'later', title: 'later', nextDueAt: Date.now() + 5 * HOUR }),
      schedule({ id: 'sooner', title: 'sooner', nextDueAt: Date.now() + HOUR })
    ])
    const b = useScheduleBadges()
    b.start()
    await flushPromises()
    expect(b.soonestFor('c1')?.title).toBe('sooner')
    b.stop()
  })

  it('ignores a disabled schedule, because nothing is going to happen', async () => {
    listSchedules.mockResolvedValue([schedule({ enabled: false })])
    const b = useScheduleBadges()
    b.start()
    await flushPromises()
    expect(b.soonestFor('c1')).toBeNull()
    b.stop()
  })

  it('ignores launch schedules, which belong to no conversation', async () => {
    listSchedules.mockResolvedValue([
      schedule({ target: { kind: 'launch', session: { mode: 'yolo', folder: '/repo' } } })
    ])
    const b = useScheduleBadges()
    b.start()
    await flushPromises()
    expect(b.soonestFor('c1')).toBeNull()
    b.stop()
  })

  it('re-reads when main says the list moved', async () => {
    const b = useScheduleBadges()
    b.start()
    await flushPromises()
    expect(b.soonestFor('c1')).toBeNull()
    listSchedules.mockResolvedValue([schedule()])
    changedCb()
    await flushPromises()
    expect(b.soonestFor('c1')?.title).toBe('nightly sweep')
    b.stop()
  })

  it('leaves the badges off rather than throwing when the bridge fails', async () => {
    listSchedules.mockRejectedValue(new Error('ipc down'))
    const b = useScheduleBadges()
    b.start()
    await flushPromises()
    expect(b.soonestFor('c1')).toBeNull()
    b.stop()
  })

  it('survives a preload with no schedules bridge at all', async () => {
    ;(window as unknown as { api: unknown }).api = { listSchedules }
    const b = useScheduleBadges()
    expect(() => b.start()).not.toThrow()
    await flushPromises()
    b.stop()
  })

  it('stops its ticking and its subscription', async () => {
    vi.useFakeTimers()
    const off = vi.fn()
    onSchedulesChanged.mockReturnValue(off)
    const b = useScheduleBadges()
    b.start()
    const before = b.now.value
    b.stop()
    expect(off).toHaveBeenCalled()
    vi.advanceTimersByTime(60_000)
    expect(b.now.value).toBe(before) // no ticking after stop
  })
})
