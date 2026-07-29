import { describe, it, expect, vi } from 'vitest'
import { createStatusHub } from './status-hub'
import type { SessionActivity } from './activity'
import type { StatusScanRequest, StatusUpdateEvent } from '../../shared/ipc'

// A fake activity tracker whose quiet watch we fire on demand. Mirrors the real
// one-shot watch: `watch` stores the callback; the hub re-arms by calling watch
// again, so `fireQuiet` always invokes the latest.
function harness() {
  const watchers = new Map<string, () => void>()
  const updates: StatusUpdateEvent[] = []
  const scans: StatusScanRequest[] = []
  const activity: SessionActivity = {
    data: vi.fn(),
    clear: vi.fn(),
    watch: (id, _opts, onQuiet) => {
      watchers.set(id, onQuiet)
      return () => { if (watchers.get(id) === onQuiet) watchers.delete(id) }
    }
  }
  const hub = createStatusHub({
    activity,
    sendScanRequest: (r) => scans.push(r),
    sendUpdate: (e) => updates.push(e)
  })
  return {
    hub,
    updates,
    scans,
    fireQuiet: (id: string) => watchers.get(id)?.(),
    isArmed: (id: string) => watchers.has(id)
  }
}

describe('createStatusHub — pty lifecycle', () => {
  it('registers working and arms a quiet watch', () => {
    const h = harness()
    h.hub.registerPty('a', 'interactive', ['Proceed\\?'])
    expect(h.updates).toEqual([{ id: 'a', status: 'working' }])
    expect(h.isArmed('a')).toBe(true)
  })

  it('on quiet it asks the renderer to scan, then transitions on the reply', () => {
    const h = harness()
    h.hub.registerPty('a', 'interactive', ['Proceed\\?'])
    h.fireQuiet('a')
    expect(h.scans).toEqual([{ id: 'a', patterns: ['Proceed\\?'] }])
    // No state change until the reply comes back.
    expect(h.updates).toEqual([{ id: 'a', status: 'working' }])

    h.hub.scanResult('a', false)
    expect(h.updates.at(-1)).toEqual({ id: 'a', status: 'idle' })
  })

  it('a matched scan → needsYou', () => {
    const h = harness()
    h.hub.registerPty('a', 'interactive', ['Proceed\\?'])
    h.fireQuiet('a')
    h.hub.scanResult('a', true)
    expect(h.updates.at(-1)).toEqual({ id: 'a', status: 'needsYou' })
  })

  it('re-arms after each quiet so later turns are scanned too', () => {
    const h = harness()
    h.hub.registerPty('a', 'interactive', ['Proceed\\?'])
    h.fireQuiet('a')
    h.hub.scanResult('a', false) // idle
    h.hub.data('a') // working again
    expect(h.updates.at(-1)).toEqual({ id: 'a', status: 'working' })
    h.fireQuiet('a') // still armed → second scan request
    expect(h.scans).toHaveLength(2)
  })

  it('does not push redundant updates (working output stays working silently)', () => {
    const h = harness()
    h.hub.registerPty('a', 'interactive', [])
    h.hub.data('a')
    h.hub.data('a')
    expect(h.updates).toEqual([{ id: 'a', status: 'working' }]) // only the initial
  })

  it('interactive exit 0 → failed (S1 interim), non-zero → failed; watch stops', () => {
    const h = harness()
    h.hub.registerPty('a', 'interactive', [])
    h.hub.exit('a', 0)
    expect(h.updates.at(-1)).toEqual({ id: 'a', status: 'failed' })
    expect(h.isArmed('a')).toBe(false)
  })
})

describe('createStatusHub — headless lifecycle', () => {
  it('registers working, never arms a scan, and resolves on exit', () => {
    const h = harness()
    h.hub.registerHeadless('y')
    expect(h.updates).toEqual([{ id: 'y', status: 'working' }])
    expect(h.isArmed('y')).toBe(false) // headless is never scanned

    h.hub.data('y') // a log line keeps it working
    expect(h.updates).toEqual([{ id: 'y', status: 'working' }])

    h.hub.exit('y', 0)
    expect(h.updates.at(-1)).toEqual({ id: 'y', status: 'needsReview' })
  })

  it('headless non-zero exit → failed', () => {
    const h = harness()
    h.hub.registerHeadless('y')
    h.hub.exit('y', 1)
    expect(h.updates.at(-1)).toEqual({ id: 'y', status: 'failed' })
  })
})

describe('createStatusHub — housekeeping', () => {
  it('ignores events for unknown ids', () => {
    const h = harness()
    h.hub.data('ghost')
    h.hub.scanResult('ghost', true)
    h.hub.exit('ghost', 0)
    expect(h.updates).toEqual([])
  })

  it('dispose cancels the watch and forgets the session', () => {
    const h = harness()
    h.hub.registerPty('a', 'shell', [])
    h.hub.dispose('a')
    expect(h.isArmed('a')).toBe(false)
    h.hub.data('a') // forgotten → no-op
    expect(h.updates).toEqual([{ id: 'a', status: 'working' }])
  })

  it('a full pty turn: working → idle → working → needsYou → failed', () => {
    const h = harness()
    h.hub.registerPty('a', 'interactive', ['Proceed\\?'])
    h.fireQuiet('a'); h.hub.scanResult('a', false) // idle
    h.hub.data('a') // working
    h.fireQuiet('a'); h.hub.scanResult('a', true) // needsYou
    h.hub.exit('a', 1) // failed
    expect(h.updates.map((u) => u.status)).toEqual(['working', 'idle', 'working', 'needsYou', 'failed'])
  })
})
