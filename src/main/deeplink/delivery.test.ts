import { describe, expect, it, vi } from 'vitest'
import { DeepLinkDelivery } from './delivery'
import type { DeepLink } from '../../shared/ipc'

const open = (ticket: string): DeepLink => ({ action: 'open', ticket })
const yolo = (ticket: string): DeepLink => ({ action: 'yolo', ticket })

function make(): { d: DeepLinkDelivery; send: ReturnType<typeof vi.fn>; ensureWindow: ReturnType<typeof vi.fn> } {
  const send = vi.fn()
  const ensureWindow = vi.fn()
  return { d: new DeepLinkDelivery({ send, ensureWindow }), send, ensureWindow }
}

describe('DeepLinkDelivery', () => {
  it('queues links until the renderer is ready, then flushes in order', () => {
    const { d, send } = make()
    d.deliver(open('SD-1'))
    d.deliver(yolo('SD-2'))
    expect(send).not.toHaveBeenCalled()
    d.rendererReady()
    expect(send.mock.calls).toEqual([[open('SD-1')], [yolo('SD-2')]])
  })

  it('sends directly once ready', () => {
    const { d, send, ensureWindow } = make()
    d.rendererReady()
    d.deliver(yolo('SD-3'))
    expect(send).toHaveBeenCalledWith(yolo('SD-3'))
    expect(ensureWindow).not.toHaveBeenCalled()
  })

  it('summons a window for a link that arrives with no renderer', () => {
    const { d, ensureWindow } = make()
    d.deliver(open('SD-4'))
    expect(ensureWindow).toHaveBeenCalledTimes(1)
  })

  it('window closed → queue again and summon a new window (macOS zero-window state)', () => {
    const { d, send, ensureWindow } = make()
    d.rendererReady()
    d.windowClosed()
    d.deliver(yolo('SD-5'))
    expect(send).not.toHaveBeenCalled()
    expect(ensureWindow).toHaveBeenCalledTimes(1)
    d.rendererReady()
    expect(send).toHaveBeenCalledWith(yolo('SD-5'))
  })

  it('rendererReady with an empty queue sends nothing', () => {
    const { d, send } = make()
    d.rendererReady()
    expect(send).not.toHaveBeenCalled()
  })

  it('drainPending hands queued links to the cold-start path and empties the queue', () => {
    const { d, send } = make()
    d.deliver(open('SD-6'))
    d.deliver(yolo('SD-7'))
    expect(d.drainPending()).toEqual([open('SD-6'), yolo('SD-7')])
    // Already consumed by startup options — a later ready must not re-push them.
    d.rendererReady()
    expect(send).not.toHaveBeenCalled()
  })
})
