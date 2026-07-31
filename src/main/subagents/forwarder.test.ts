import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { startSubagentForwarding } from './forwarder'
import { SUBAGENTS } from '../../shared/ipc'
import type { SubagentWatcher } from './types'

function fakeWatcher(): SubagentWatcher & { close: ReturnType<typeof vi.fn> } {
  const em = new EventEmitter() as SubagentWatcher & { close: ReturnType<typeof vi.fn> }
  em.close = vi.fn()
  return em
}

describe('startSubagentForwarding', () => {
  it('forwards spawn/activity/done from both watchers to the sender, tagged by channel', () => {
    const claude = fakeWatcher()
    const codex = fakeWatcher()
    const send = vi.fn()
    startSubagentForwarding({
      getSender: () => ({ send }) as unknown as Electron.WebContents,
      makeClaude: () => claude,
      makeCodex: () => codex
    })

    const spawn = { session: 's', agent: 'a', ts: 1 }
    const activity = { session: 's', agent: 'a', kind: 'tool' as const, tool: 'Read', target: '/f', ts: 2 }
    const done = { session: 's', agent: 's', ts: 3 }
    claude.emit('spawn', spawn)
    claude.emit('activity', activity)
    codex.emit('done', done)

    expect(send).toHaveBeenCalledWith(SUBAGENTS.spawn, spawn)
    expect(send).toHaveBeenCalledWith(SUBAGENTS.activity, activity)
    expect(send).toHaveBeenCalledWith(SUBAGENTS.done, done)
  })

  it('drops events when there is no focused window (getSender → undefined)', () => {
    const claude = fakeWatcher()
    const codex = fakeWatcher()
    startSubagentForwarding({ getSender: () => undefined, makeClaude: () => claude, makeCodex: () => codex })
    // No sender: emitting must not throw.
    expect(() => claude.emit('spawn', { session: 's', agent: 'a', ts: 1 })).not.toThrow()
  })

  it('a watcher error never throws (non-fatal)', () => {
    const claude = fakeWatcher()
    const codex = fakeWatcher()
    startSubagentForwarding({ getSender: () => undefined, makeClaude: () => claude, makeCodex: () => codex })
    // With a listener attached, emitting 'error' would otherwise throw if unhandled.
    expect(() => claude.emit('error', new Error('boom'))).not.toThrow()
  })

  it('dispose() closes both watchers', () => {
    const claude = fakeWatcher()
    const codex = fakeWatcher()
    const { dispose } = startSubagentForwarding({
      getSender: () => undefined,
      makeClaude: () => claude,
      makeCodex: () => codex
    })
    dispose()
    expect(claude.close).toHaveBeenCalledTimes(1)
    expect(codex.close).toHaveBeenCalledTimes(1)
  })
})
