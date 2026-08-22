import { createJsonStore, type JsonStore, type VersionedDoc } from '../store/json-store'
import { schedulesPath } from '../store/paths'
import type { Schedule, ScheduleCreate, ScheduleOutcome, ScheduleTarget, ScheduleTrigger, StartupSession } from '../../shared/ipc'
import type { ScheduleRunState } from './scheduler'
import { nextDueAfter } from './scheduler'

// The record itself is a wire type (shared/ipc.ts): the modal shows every field,
// so it crosses the bridge whole. Re-exported here so main-side callers have one
// import for the store and the shape it holds.
export type { Schedule, ScheduleCreate, ScheduleTarget, ScheduleTrigger } from '../../shared/ipc'

export interface SchedulesDoc extends VersionedDoc {
  version: 1
  schedules: Schedule[]
}

// A recurring schedule with no cap is not a valid record, so the migrate and
// create paths both force one rather than rejecting the schedule outright:
// degrading to a bounded schedule is the safe direction, refusing to load one is
// not. Roughly two days of a half-hourly schedule — long enough to be useful,
// short enough that an abandoned schedule stops on its own.
export const DEFAULT_MAX_FIRINGS = 100

function normaliseMaxFirings(trigger: ScheduleTrigger, raw: unknown): number | null {
  if (trigger.kind === 'once') return typeof raw === 'number' ? raw : null
  return typeof raw === 'number' && raw > 0 ? raw : DEFAULT_MAX_FIRINGS
}

function parseTarget(raw: unknown): ScheduleTarget | null {
  const t = raw as Partial<ScheduleTarget> & { conversationId?: unknown; session?: unknown }
  if (t?.kind === 'conversation' && typeof t.conversationId === 'string') {
    return { kind: 'conversation', conversationId: t.conversationId }
  }
  if (t?.kind === 'launch' && t.session && typeof t.session === 'object') {
    const ticket = (raw as { ticket?: unknown }).ticket
    return {
      kind: 'launch',
      session: t.session as StartupSession,
      ...(typeof ticket === 'string' ? { ticket } : {})
    }
  }
  return null
}

function parseTrigger(raw: unknown): ScheduleTrigger | null {
  const t = raw as { kind?: unknown; atMs?: unknown; intervalMs?: unknown; notBeforeMs?: unknown; hour?: unknown; minute?: unknown }
  if (t?.kind === 'once' && typeof t.atMs === 'number') return { kind: 'once', atMs: t.atMs }
  if (t?.kind === 'every' && typeof t.intervalMs === 'number' && t.intervalMs > 0) {
    return { kind: 'every', intervalMs: t.intervalMs, notBeforeMs: typeof t.notBeforeMs === 'number' ? t.notBeforeMs : null }
  }
  if (t?.kind === 'daily' && typeof t.hour === 'number' && typeof t.minute === 'number') {
    return { kind: 'daily', hour: t.hour, minute: t.minute }
  }
  return null
}

const OUTCOMES: ReadonlySet<string> = new Set(['fired', 'deferred', 'skipped', 'missed', 'failed'])

// Any record that cannot be understood is dropped, not repaired into a guess: a
// schedule with an unparseable trigger would otherwise fire at an unknown time.
function migrateSchedules(raw: unknown): SchedulesDoc {
  const o = (raw ?? {}) as { schedules?: unknown }
  const list = Array.isArray(o.schedules) ? o.schedules : []
  const schedules: Schedule[] = []
  for (const item of list) {
    const s = item as Partial<Schedule> & Record<string, unknown>
    if (typeof s?.id !== 'string') continue
    const target = parseTarget(s.target)
    const trigger = parseTrigger(s.trigger)
    if (!target || !trigger) continue
    schedules.push({
      id: s.id,
      enabled: typeof s.enabled === 'boolean' ? s.enabled : true,
      title: typeof s.title === 'string' ? s.title : '',
      target,
      prompt: typeof s.prompt === 'string' ? s.prompt : '',
      trigger,
      catchUp: typeof s.catchUp === 'boolean' ? s.catchUp : false,
      maxFirings: normaliseMaxFirings(trigger, s.maxFirings),
      stopOnFailure: typeof s.stopOnFailure === 'boolean' ? s.stopOnFailure : true,
      firedCount: typeof s.firedCount === 'number' ? s.firedCount : 0,
      nextDueAt: typeof s.nextDueAt === 'number' ? s.nextDueAt : 0,
      lastFiredAt: typeof s.lastFiredAt === 'number' ? s.lastFiredAt : null,
      lastOutcome: typeof s.lastOutcome === 'string' && OUTCOMES.has(s.lastOutcome) ? (s.lastOutcome as ScheduleOutcome) : null,
      lastReason: typeof s.lastReason === 'string' ? s.lastReason : null,
      deferredSinceAt: typeof s.deferredSinceAt === 'number' ? s.deferredSinceAt : null,
      createdAt: typeof s.createdAt === 'number' ? s.createdAt : 0
    })
  }
  return { version: 1, schedules }
}

export interface SchedulesStore {
  list(): Schedule[]
  get(id: string): Schedule | undefined
  byConversation(conversationId: string): Schedule[]
  create(c: ScheduleCreate): Schedule
  setEnabled(id: string, enabled: boolean): void
  // Write back the run state scheduler.advance() computed. No-op if the schedule
  // was deleted while a firing was in flight.
  recordOutcome(id: string, state: ScheduleRunState): void
  remove(id: string): void
  flush(): void
}

function randomId(): string {
  return (globalThis.crypto as { randomUUID(): string }).randomUUID()
}

export function createSchedulesStore(deps?: {
  file?: string
  now?: () => number
  newId?: () => string
}): SchedulesStore {
  const now = deps?.now ?? Date.now
  const newId = deps?.newId ?? randomId
  const store: JsonStore<SchedulesDoc> = createJsonStore({
    file: deps?.file ?? schedulesPath(),
    migrate: migrateSchedules
  })

  return {
    list: () => store.get().schedules,
    get: (id) => store.get().schedules.find((s) => s.id === id),
    byConversation: (conversationId) =>
      store
        .get()
        .schedules.filter((s) => s.target.kind === 'conversation' && s.target.conversationId === conversationId),

    create(c) {
      const t = now()
      // A schedule created for a slot already in the past would be due on the
      // very next tick. nextDueAfter(t) is the first slot strictly after
      // creation, so "daily at 5am" made at 5:01am means tomorrow, not seconds
      // from now. A spent `once` (a time already gone) lands disabled.
      const next = nextDueAfter(c.trigger, t, t)
      const created: Schedule = {
        id: newId(),
        enabled: next !== null,
        title: c.title?.trim() || defaultTitle(c.prompt),
        target: c.target,
        prompt: c.prompt,
        trigger: c.trigger,
        catchUp: c.catchUp ?? false,
        maxFirings: normaliseMaxFirings(c.trigger, c.maxFirings),
        stopOnFailure: c.stopOnFailure ?? true,
        firedCount: 0,
        nextDueAt: next ?? t,
        lastFiredAt: null,
        lastOutcome: null,
        lastReason: next === null ? 'the scheduled time had already passed' : null,
        deferredSinceAt: null,
        createdAt: t
      }
      store.mutate((d) => d.schedules.push(created))
      return created
    },

    setEnabled(id, enabled) {
      const s = store.get().schedules.find((x) => x.id === id)
      if (!s) return
      store.mutate(() => {
        s.enabled = enabled
        // Re-enabling something whose slot has passed would fire it immediately;
        // move it to the next real slot instead.
        if (enabled && s.nextDueAt <= now()) {
          const next = nextDueAfter(s.trigger, now(), s.createdAt)
          if (next === null) s.enabled = false
          else s.nextDueAt = next
        }
      })
    },

    recordOutcome(id, state) {
      const s = store.get().schedules.find((x) => x.id === id)
      if (!s) return
      store.mutate(() => {
        s.enabled = state.enabled
        s.firedCount = state.firedCount
        s.nextDueAt = state.nextDueAt
        s.lastFiredAt = state.lastFiredAt
        s.lastOutcome = state.lastOutcome
        s.lastReason = state.lastReason
        s.deferredSinceAt = state.deferredSinceAt
      })
    },

    remove(id) {
      store.mutate((d) => {
        const i = d.schedules.findIndex((x) => x.id === id)
        if (i >= 0) d.schedules.splice(i, 1)
      })
    },

    flush: () => store.flush()
  }
}

// The list has to say what a schedule DOES at a glance; an untitled one borrows
// the head of its prompt rather than showing a bare id.
function defaultTitle(prompt: string): string {
  const line = prompt.trim().split('\n')[0] ?? ''
  return line.length > 60 ? `${line.slice(0, 57)}...` : line || 'Untitled schedule'
}
