import type { EventEmitter } from 'node:events'

// Shared event contract for the CLI-agent activity watchers (claude + codex).
// These modules are pure main-process Node — no electron, no IPC, no renderer,
// no app-scoping. The watchers emit an event for EVERY subagent/session they
// see under the CLI's transcript tree; the IPC layer and renderer decide what to
// keep. Ported from racconsole's watcher.mjs / codex.mjs (read-only tailers).

export type SubagentActivityKind = 'tool' | 'text' | 'thinking'

// A new subagent/session appeared. For claude, `session` is the parent Claude
// Code session id and `agent` the per-worker agent id; for codex there are no
// subagents, so `session === agent` (the rollout's UUID).
export interface SubagentSpawnEvent {
  session: string
  agent: string
  agentType?: string
  description?: string
  ts: number
}

// One unit of visible work by a subagent/session: a tool call, an assistant text
// chunk, or a thinking chunk. `tool`/`target` are set for kind:'tool'; `text` is
// set for kind:'text' and kind:'thinking'.
export interface SubagentActivityEvent {
  session: string
  agent: string
  kind: SubagentActivityKind
  tool?: string
  target?: string
  text?: string
  ts: number
}

// A session finished (codex only — emitted on a `task_complete` rollout line).
export interface SubagentDoneEvent {
  session: string
  agent: string
  ts: number
}

// The activity payload as produced by the pure line parsers, before the watcher
// stamps on session/agent/ts. Kept separate so the parsers stay unit-testable
// without a real file watch.
export type SubagentActivityPayload = Pick<
  SubagentActivityEvent,
  'kind' | 'tool' | 'target' | 'text'
>

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
