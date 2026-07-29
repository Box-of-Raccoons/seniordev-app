import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSessionActivity } from './activity'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('createSessionActivity', () => {
  it('resolves once output arrives after the watch and then falls quiet for quietMs', async () => {
    const act = createSessionActivity()
    const onQuiet = vi.fn()
    act.watch('a', { quietMs: 700 }, onQuiet)

    act.data('a')                         // output arrives
    await vi.advanceTimersByTimeAsync(600) // not quiet long enough yet
    expect(onQuiet).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200) // now past 700ms of quiet
    expect(onQuiet).toHaveBeenCalledTimes(1)
  })

  it('does not resolve while output keeps arriving (session stays working)', async () => {
    const act = createSessionActivity()
    const onQuiet = vi.fn()
    act.watch('a', { quietMs: 700 }, onQuiet)

    for (let i = 0; i < 5; i++) {
      act.data('a')
      await vi.advanceTimersByTimeAsync(400) // fresh output before the 700ms lapses
    }
    expect(onQuiet).not.toHaveBeenCalled()
  })

  it('never resolves via the data path when no output ever arrives', async () => {
    const act = createSessionActivity()
    const onQuiet = vi.fn()
    act.watch('a', { quietMs: 700 }, onQuiet) // no maxWaitMs

    await vi.advanceTimersByTimeAsync(60_000)
    expect(onQuiet).not.toHaveBeenCalled()
  })

  it('resolves via the maxWaitMs safety valve when the session never produces output', async () => {
    const act = createSessionActivity()
    const onQuiet = vi.fn()
    act.watch('a', { quietMs: 700, maxWaitMs: 15_000 }, onQuiet)

    await vi.advanceTimersByTimeAsync(14_000)
    expect(onQuiet).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_500)
    expect(onQuiet).toHaveBeenCalledTimes(1)
  })

  it('ignores output that arrived before the watch began', async () => {
    const act = createSessionActivity()
    act.data('a')                          // stale output, before any watch
    await vi.advanceTimersByTimeAsync(1_000)

    const onQuiet = vi.fn()
    act.watch('a', { quietMs: 700 }, onQuiet) // start mark is now, after the stale data
    await vi.advanceTimersByTimeAsync(2_000)
    expect(onQuiet).not.toHaveBeenCalled()  // stale data must not settle it
  })

  it('cancelling a watch prevents a pending resolution', async () => {
    const act = createSessionActivity()
    const onQuiet = vi.fn()
    const cancel = act.watch('a', { quietMs: 700 }, onQuiet)

    act.data('a')
    await vi.advanceTimersByTimeAsync(300)
    cancel()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(onQuiet).not.toHaveBeenCalled()
  })

  it('clear() forgets a session so a later watch sees no prior output', async () => {
    const act = createSessionActivity()
    act.data('a')
    act.clear('a')

    const onQuiet = vi.fn()
    act.watch('a', { quietMs: 700 }, onQuiet)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(onQuiet).not.toHaveBeenCalled() // cleared data must not count
  })

  it('tracks sessions independently by id', async () => {
    const act = createSessionActivity()
    const onA = vi.fn()
    const onB = vi.fn()
    act.watch('a', { quietMs: 700 }, onA)
    act.watch('b', { quietMs: 700 }, onB)

    act.data('a') // only session a produced output
    await vi.advanceTimersByTimeAsync(800)
    expect(onA).toHaveBeenCalledTimes(1)
    expect(onB).not.toHaveBeenCalled()
  })

  it('re-arms continuously: a fresh watch after resolution fires only on new output (status pattern)', async () => {
    const act = createSessionActivity()
    const quiets: number[] = []
    const arm = (): void => {
      act.watch('a', { quietMs: 700 }, () => {
        quiets.push(1)
        arm() // status monitor re-arms after each quiet
      })
    }
    arm()

    act.data('a')
    await vi.advanceTimersByTimeAsync(800)
    expect(quiets.length).toBe(1) // first quiet

    // The re-armed watch must NOT fire again without new output...
    await vi.advanceTimersByTimeAsync(5_000)
    expect(quiets.length).toBe(1)

    // ...but a new burst of output that then goes quiet resolves it again.
    act.data('a')
    await vi.advanceTimersByTimeAsync(800)
    expect(quiets.length).toBe(2)
  })
})
