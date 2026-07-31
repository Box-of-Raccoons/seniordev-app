import type { EventEmitter } from 'node:events'
import type { SubagentSpawnEvent, SubagentActivityEvent, SubagentDoneEvent } from '../../shared/ipc'

// The CLI-agent activity watchers (claude + codex) are pure main-process Node —
// no electron, no IPC, no renderer, no app-scoping. Each watcher emits an event
// for EVERY subagent/session it sees under the CLI's transcript tree; the IPC
// layer forwards them and the renderer decides what to keep. Ported from
// racconsole's watcher.mjs / codex.mjs (read-only tailers).
//
// The wire event shapes live in shared/ipc.ts (the renderer's panel needs them
// too); they are re-exported here so the watcher modules keep importing from
// './types' unchanged.
export type { SubagentSpawnEvent, SubagentActivityEvent, SubagentDoneEvent } from '../../shared/ipc'
export type { SubagentActivityKind } from '../../shared/ipc'

// The activity payload as produced by the pure line parsers, before the watcher
// stamps on session/agent/ts. Kept separate so the parsers stay unit-testable
// without a real file watch.
export type SubagentActivityPayload = Pick<SubagentActivityEvent, 'kind' | 'tool' | 'target' | 'text'>

// An EventEmitter narrowed to the events these watchers emit, plus close().
// `close()` stops the poll timer and the underlying chokidar watcher.
export interface SubagentWatcher extends EventEmitter {
  on(event: 'spawn', listener: (e: SubagentSpawnEvent) => void): this
  on(event: 'activity', listener: (e: SubagentActivityEvent) => void): this
  on(event: 'done', listener: (e: SubagentDoneEvent) => void): this
  on(event: 'ready', listener: () => void): this
  on(event: 'error', listener: (err: Error) => void): this
  on(event: string | symbol, listener: (...args: unknown[]) => void): this

  emit(event: 'spawn', e: SubagentSpawnEvent): boolean
  emit(event: 'activity', e: SubagentActivityEvent): boolean
  emit(event: 'done', e: SubagentDoneEvent): boolean
  emit(event: 'ready'): boolean
  emit(event: 'error', err: Error): boolean
  emit(event: string | symbol, ...args: unknown[]): boolean

  close(): void
}
