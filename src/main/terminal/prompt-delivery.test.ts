import { describe, it, expect, vi, afterEach } from 'vitest'
import { createPromptDelivery, SUBMIT_DELAY_MS, MAX_WAIT_MS } from './prompt-delivery'
import { createSessionActivity } from './activity'

// A real SessionActivity, so these exercise the actual quiet semantics rather
// than a stub's idea of them. That distinction is the whole point here: watch()
// only resolves on output arriving AFTER the watch begins, which is what makes
// the readiness path wrong for an already-idle session.
function harness() {
  const writes: Array<{ id: string; data: string }> = []
  const activity = createSessionActivity()
  const delivery = createPromptDelivery({ write: (id, data) => writes.push({ id, data }), activity })
  return { writes, activity, delivery, data: (id: string) => activity.data(id) }
}

afterEach(() => vi.useRealTimers())

describe('deliverNow — the scheduled path', () => {
  it('writes immediately, with no readiness wait', () => {
    vi.useFakeTimers()
    const h = harness()
    h.delivery.deliverNow('a', 'continue', false)
    // Not "soon" — now. The caller already established the session is receptive.
    expect(h.writes).toEqual([{ id: 'a', data: 'continue' }])
  })

  it('submits with Enter as its own keystroke a beat later', () => {
    vi.useFakeTimers()
    const h = harness()
    h.delivery.deliverNow('a', 'continue', false)
    vi.advanceTimersByTime(SUBMIT_DELAY_MS)
    expect(h.writes.map((w) => w.data)).toEqual(['continue', '\r'])
  })

  it('does NOT sit through the safety valve on a session that emits nothing', () => {
    // The defect this exists to prevent, measured against a real pty before the
    // fix: an established idle session produces no output, so the quiet watch
    // never resolved and delivery fell through the 15s valve every time — during
    // which the session could reach an approval prompt and be typed into anyway.
    vi.useFakeTimers()
    const h = harness()
    h.delivery.deliverNow('a', 'continue', false)
    vi.advanceTimersByTime(SUBMIT_DELAY_MS)
    expect(h.writes).toHaveLength(2)

    // The old path, for contrast: nothing at all until the valve trips.
    const old = harness()
    old.delivery.deliver('a', 'continue', false)
    vi.advanceTimersByTime(MAX_WAIT_MS - 1)
    expect(old.writes).toEqual([])
  })

  it('still waits for the paste to render before submitting a bracketed one', () => {
    vi.useFakeTimers()
    const h = harness()
    h.delivery.deliverNow('a', 'line one\nline two', true)
    expect(h.writes[0].data).toBe('\x1b[200~line one\nline two\x1b[201~')
    expect(h.writes).toHaveLength(1) // Enter withheld until the paste settles
    // The paste itself is the output the quiet watch needs, so this resolves.
    h.data('a')
    vi.advanceTimersByTime(1000)
    expect(h.writes.map((w) => w.data).at(-1)).toBe('\r')
  })

  it('is cancellable mid-delivery, like a launch delivery', () => {
    vi.useFakeTimers()
    const h = harness()
    h.delivery.deliverNow('a', 'continue', false)
    h.delivery.cancel('a')
    vi.advanceTimersByTime(SUBMIT_DELAY_MS * 3)
    // The text landed, but the submit never fires into a killed tab.
    expect(h.writes.map((w) => w.data)).toEqual(['continue'])
  })
})

describe('deliver — the launch path is unchanged', () => {
  it('waits for output then quiet before writing anything', () => {
    vi.useFakeTimers()
    const h = harness()
    h.delivery.deliver('a', 'go', false)
    expect(h.writes).toEqual([])
    h.data('a') // the TUI finished painting its boot screen
    vi.advanceTimersByTime(1000) // quiet elapsed
    expect(h.writes[0]).toEqual({ id: 'a', data: 'go' })
  })
})

describe('one prompt in flight per session', () => {
  it('holds a second delivery until the first has submitted', () => {
    // Two schedules aimed at the same conversation can come due on one tick.
    // Unserialized their writes interleave into a single garbled prompt.
    vi.useFakeTimers()
    const h = harness()
    h.delivery.deliverNow('a', 'first', false)
    h.delivery.deliverNow('a', 'second', false)
    expect(h.writes.map((w) => w.data)).toEqual(['first'])
    vi.advanceTimersByTime(SUBMIT_DELAY_MS)
    expect(h.writes.map((w) => w.data)).toEqual(['first', '\r', 'second'])
    vi.advanceTimersByTime(SUBMIT_DELAY_MS)
    expect(h.writes.map((w) => w.data)).toEqual(['first', '\r', 'second', '\r'])
  })

  it('drops the queue when the session is cancelled mid-delivery', () => {
    // A killed pty must not receive the prompts still waiting their turn.
    vi.useFakeTimers()
    const h = harness()
    h.delivery.deliverNow('a', 'first', false)
    h.delivery.deliverNow('a', 'second', false)
    h.delivery.cancel('a')
    vi.advanceTimersByTime(SUBMIT_DELAY_MS * 5)
    expect(h.writes.map((w) => w.data)).toEqual(['first'])
  })

  it('does not serialize across different sessions', () => {
    vi.useFakeTimers()
    const h = harness()
    h.delivery.deliverNow('a', 'alpha', false)
    h.delivery.deliverNow('b', 'beta', false)
    expect(h.writes).toEqual([
      { id: 'a', data: 'alpha' },
      { id: 'b', data: 'beta' }
    ])
    vi.advanceTimersByTime(SUBMIT_DELAY_MS)
    expect(h.writes).toEqual([
      { id: 'a', data: 'alpha' },
      { id: 'b', data: 'beta' },
      { id: 'a', data: '\r' },
      { id: 'b', data: '\r' }
    ])
  })
})
