import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSubagents, type SubagentApi } from './useSubagents'
import { ACTIVE_MS, REMOVE_MS } from './subagent-tiles'
import type { SubagentSpawnEvent, SubagentActivityEvent, SubagentDoneEvent } from '../../../shared/ipc'

// A fake api that captures the registered callbacks so a test can drive events.
function fakeApi(): SubagentApi & {
  spawn: (e: SubagentSpawnEvent) => void
  activity: (e: SubagentActivityEvent) => void
  done: (e: SubagentDoneEvent) => void
  offs: number
} {
  const cbs: { spawn?: (e: SubagentSpawnEvent) => void; activity?: (e: SubagentActivityEvent) => void; done?: (e: SubagentDoneEvent) => void } = {}
  const state = { offs: 0 }
  const off = (): (() => void) => () => {
    state.offs++
  }
  return {
    onSubagentSpawn: (cb) => ((cbs.spawn = cb), off()),
    onSubagentActivity: (cb) => ((cbs.activity = cb), off()),
    onSubagentDone: (cb) => ((cbs.done = cb), off()),
    spawn: (e) => cbs.spawn?.(e),
    activity: (e) => cbs.activity?.(e),
    done: (e) => cbs.done?.(e),
    get offs() {
      return state.offs
    }
  }
}

describe('useSubagents', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('assembles tiles from spawn + activity, newest-first', () => {
    let clockNow = 1000
    const api = fakeApi()
    const s = useSubagents({ api, now: () => clockNow })
    s.start()

    api.spawn({ session: 'p1', agent: 'a1', agentType: 'Explore', ts: 1000 })
    api.activity({ session: 'p1', agent: 'a1', kind: 'tool', tool: 'Read', target: '/f', ts: 1005 })
    api.spawn({ session: 'p2', agent: 'a2', agentType: 'general-purpose', ts: 2000 })

    expect(s.totalCount.value).toBe(2)
    expect(s.tiles.value.map((t) => t.agent)).toEqual(['a2', 'a1']) // a2 more recent
    expect(s.tiles.value.find((t) => t.agent === 'a1')!.lines).toEqual(['▸ Read /f'])
    s.stop()
  })

  it('applies the "this app only" filter against known sessions', () => {
    const api = fakeApi()
    const s = useSubagents({ api, now: () => 1000 })
    s.start()
    api.spawn({ session: 'mine', agent: 'a1', ts: 1000 })
    api.spawn({ session: 'someone-else', agent: 'a2', ts: 1000 })

    expect(s.tiles.value).toHaveLength(2)
    s.setKnownSessions(['mine'])
    s.appOnly.value = true
    expect(s.tiles.value.map((t) => t.agent)).toEqual(['a1'])
    s.stop()
  })

  it('derives status off the ticking clock (active → idle as time passes)', () => {
    let clockNow = 1000
    const api = fakeApi()
    const s = useSubagents({ api, now: () => clockNow, tickMs: 1000 })
    s.start()
    api.spawn({ session: 'p', agent: 'a', ts: 1000 })
    const tile = s.tiles.value[0]
    expect(s.statusOf(tile)).toBe('active')

    // Advance the injected clock past ACTIVE_MS and let the interval refresh `now`.
    clockNow = 1000 + ACTIVE_MS + 1000
    vi.advanceTimersByTime(1000)
    expect(s.statusOf(tile)).toBe('idle')
    s.stop()
  })

  it('done marks a tile finished; clearFinished removes it', () => {
    const api = fakeApi()
    const s = useSubagents({ api, now: () => 1000 })
    s.start()
    api.spawn({ session: 'p', agent: 'a', ts: 1000 })
    api.done({ session: 'p', agent: 'a', ts: 1000 })
    expect(s.statusOf(s.tiles.value[0])).toBe('done')
    s.clearFinished()
    expect(s.totalCount.value).toBe(0)
    s.stop()
  })

  it('auto-prunes a tile once it has been quiet past REMOVE_MS (on tick)', () => {
    let clockNow = 1000
    const api = fakeApi()
    const s = useSubagents({ api, now: () => clockNow, tickMs: 1000 })
    s.start()
    api.spawn({ session: 'p', agent: 'a', ts: 1000 })
    expect(s.totalCount.value).toBe(1)
    // Jump past the removal window and let the interval tick fire the prune.
    clockNow = 1000 + REMOVE_MS + 2000
    vi.advanceTimersByTime(1000)
    expect(s.totalCount.value).toBe(0)
    s.stop()
  })

  it('nameOf returns the parent session title when set, else undefined', () => {
    const api = fakeApi()
    const s = useSubagents({ api, now: () => 1000 })
    s.start()
    api.spawn({ session: 'p1', agent: 'a1', ts: 1000 })
    api.spawn({ session: 'external', agent: 'a2', ts: 1000 })
    s.setSessionNames(new Map([['p1', 'My Session']]))
    const byAgent = Object.fromEntries(s.tiles.value.map((t) => [t.agent, t]))
    expect(s.nameOf(byAgent.a1)).toBe('My Session')
    expect(s.nameOf(byAgent.a2)).toBeUndefined()
    s.stop()
  })

  it('stop() unsubscribes every listener', () => {
    const api = fakeApi()
    const s = useSubagents({ api, now: () => 1 })
    s.start()
    s.stop()
    expect(api.offs).toBe(3)
  })
})
