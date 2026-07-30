import { describe, it, expect } from 'vitest'
import { createStatusHub } from './status-hub'
import type { StatusUpdateEvent } from '../../shared/ipc'

function harness() {
  const updates: StatusUpdateEvent[] = []
  const hub = createStatusHub({ sendUpdate: (e) => updates.push(e) })
  return { hub, updates, last: () => updates.at(-1) }
}

const PROMPT = ['Do you want to proceed\\?'] // a real captured claude pattern

describe('createStatusHub — pty lifecycle', () => {
  it('registers working', () => {
    const h = harness()
    h.hub.registerPty('a', 'interactive', PROMPT)
    expect(h.updates).toEqual([{ id: 'a', status: 'working' }])
  })

  it('settled text with no prompt → idle; with a prompt → needsYou', () => {
    const h = harness()
    h.hub.registerPty('a', 'interactive', PROMPT)
    h.hub.settled('a', 'building project...\ncompiled ok')
    expect(h.last()).toEqual({ id: 'a', status: 'idle' })
    h.hub.active('a') // output resumed
    expect(h.last()).toEqual({ id: 'a', status: 'working' })
    h.hub.settled('a', ' Do you want to proceed?\n ❯ 1. Yes\n   2. No')
    expect(h.last()).toEqual({ id: 'a', status: 'needsYou' })
  })

  it('a re-scan can flip idle → needsYou without an intervening active', () => {
    const h = harness()
    h.hub.registerPty('a', 'interactive', PROMPT)
    h.hub.settled('a', 'idle output')
    expect(h.last()).toEqual({ id: 'a', status: 'idle' })
    h.hub.settled('a', 'Do you want to proceed?')
    expect(h.last()).toEqual({ id: 'a', status: 'needsYou' })
  })

  it('does not push redundant updates', () => {
    const h = harness()
    h.hub.registerPty('a', 'interactive', [])
    h.hub.active('a')
    h.hub.active('a')
    expect(h.updates).toEqual([{ id: 'a', status: 'working' }]) // only the initial
  })

  it('interactive exit 0 → failed (S1 interim), non-zero → failed', () => {
    const h = harness()
    h.hub.registerPty('a', 'interactive', [])
    h.hub.exit('a', 0)
    expect(h.last()).toEqual({ id: 'a', status: 'failed' })
  })

  it('empty patterns never fire needsYou (graceful default)', () => {
    const h = harness()
    h.hub.registerPty('a', 'shell', [])
    h.hub.settled('a', 'Do you want to proceed?')
    expect(h.last()).toEqual({ id: 'a', status: 'idle' })
  })
})

describe('createStatusHub — headless lifecycle', () => {
  it('registers working, is never settled, resolves on exit', () => {
    const h = harness()
    h.hub.registerHeadless('y')
    expect(h.updates).toEqual([{ id: 'y', status: 'working' }])
    h.hub.active('y') // a log line keeps it working
    h.hub.settled('y', 'Do you want to proceed?') // headless is never scanned
    expect(h.updates).toEqual([{ id: 'y', status: 'working' }]) // unchanged
    h.hub.exit('y', 0)
    expect(h.last()).toEqual({ id: 'y', status: 'needsReview' })
  })

  it('headless non-zero exit → failed', () => {
    const h = harness()
    h.hub.registerHeadless('y')
    h.hub.exit('y', 1)
    expect(h.last()).toEqual({ id: 'y', status: 'failed' })
  })
})

describe('createStatusHub — housekeeping', () => {
  it('ignores events for unknown ids', () => {
    const h = harness()
    h.hub.active('ghost')
    h.hub.settled('ghost', 'x')
    h.hub.exit('ghost', 0)
    expect(h.updates).toEqual([])
  })

  it('dispose forgets the session', () => {
    const h = harness()
    h.hub.registerPty('a', 'shell', [])
    h.hub.dispose('a')
    h.hub.active('a') // forgotten → no-op
    expect(h.updates).toEqual([{ id: 'a', status: 'working' }])
  })

  it('a full pty turn: working → idle → working → needsYou → failed', () => {
    const h = harness()
    h.hub.registerPty('a', 'interactive', PROMPT)
    h.hub.settled('a', 'done') // idle
    h.hub.active('a') // working
    h.hub.settled('a', 'Do you want to proceed?') // needsYou
    h.hub.exit('a', 1) // failed
    expect(h.updates.map((u) => u.status)).toEqual(['working', 'idle', 'working', 'needsYou', 'failed'])
  })
})
