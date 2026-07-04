import { describe, it, expect } from 'vitest'
import { SequentialQueue } from './queue'

// A deferred lets the test control exactly when each job finishes.
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

describe('SequentialQueue', () => {
  const settle = (): Promise<void> => new Promise((r) => setImmediate(r))

  it('runs jobs one at a time in FIFO order', async () => {
    const q = new SequentialQueue()
    const order: number[] = []
    const d1 = deferred()
    const d2 = deferred()
    let started2 = false

    q.enqueue(async () => { order.push(1); await d1.promise; order.push(11) })
    q.enqueue(async () => { started2 = true; order.push(2); await d2.promise; order.push(22) })

    await settle()
    // Job 2 must not have started while job 1 is still pending.
    expect(started2).toBe(false)
    d1.resolve()
    await settle()
    expect(started2).toBe(true)
    d2.resolve()
    await settle()
    expect(order).toEqual([1, 11, 2, 22])
  })

  it('continues after a job throws', async () => {
    const q = new SequentialQueue()
    const ran: string[] = []
    q.enqueue(async () => { ran.push('a'); throw new Error('boom') })
    q.enqueue(async () => { ran.push('b') })
    await new Promise((r) => setImmediate(r))
    expect(ran).toEqual(['a', 'b'])
  })
})
