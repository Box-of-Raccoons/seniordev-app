import type { ScheduleCreate, ScheduleTarget, ScheduleTrigger } from '../../shared/ipc'

// Turning what the form holds into a ScheduleCreate, and saying why it cannot be
// when it cannot. Pure, so the validation is testable on its own: this is the
// only thing standing between a typo and an unattended agent run, and it is
// where "every 0 minutes" and "a prompt with no session" get caught.

export type WhenKind = 'once' | 'every' | 'daily'
export type TargetKind = 'conversation' | 'launch'

export interface ScheduleDraft {
  targetKind: TargetKind
  conversationId: string
  folder: string
  tool: string
  model: string
  yolo: boolean
  prompt: string
  whenKind: WhenKind
  // "05:00" from an <input type=time>, for once and daily.
  timeOfDay: string
  everyMinutes: number
  notBefore: string
  catchUp: boolean
  maxFirings: number
}

export function emptyDraft(): ScheduleDraft {
  return {
    targetKind: 'conversation',
    conversationId: '',
    folder: '',
    tool: '',
    model: '',
    yolo: false,
    prompt: '',
    whenKind: 'daily',
    timeOfDay: '05:00',
    everyMinutes: 30,
    notBefore: '',
    catchUp: false,
    maxFirings: 10
  }
}

// Minutes past local midnight, or null when the string is not a time.
function parseTimeOfDay(value: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

// The next occurrence of a local wall time, as a timestamp. Used for `once`,
// where "05:00" means the next 5am rather than one that has already gone.
export function nextOccurrenceOf(hour: number, minute: number, nowMs: number): number {
  const d = new Date(nowMs)
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute, 0, 0).getTime()
  if (today > nowMs) return today
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, hour, minute, 0, 0).getTime()
}

export type DraftResult = { ok: true; create: ScheduleCreate } | { ok: false; error: string }

export function buildCreate(draft: ScheduleDraft, nowMs: number): DraftResult {
  const prompt = draft.prompt.trim()
  if (!prompt) return { ok: false, error: 'Give it a prompt to deliver.' }

  let target: ScheduleTarget
  if (draft.targetKind === 'conversation') {
    if (!draft.conversationId) return { ok: false, error: 'Pick the session it should go to.' }
    target = { kind: 'conversation', conversationId: draft.conversationId }
  } else {
    const folder = draft.folder.trim()
    // An agent CLI shows a "trust this folder?" gate in an unknown directory, and
    // that gate would swallow the prompt — so a launch without a folder is refused
    // rather than left to start somewhere arbitrary.
    if (!folder) return { ok: false, error: 'Pick the folder the new session should run in.' }
    target = {
      kind: 'launch',
      session: {
        mode: draft.yolo ? 'yolo' : 'interactive',
        folder,
        promptText: prompt,
        ...(draft.tool ? { tool: draft.tool } : {}),
        // Blank means "whatever this tool would pick anyway", which is exactly
        // the absent-model behaviour, so it is omitted rather than sent empty.
        ...(draft.model.trim() ? { model: draft.model.trim() } : {})
      }
    }
  }

  let trigger: ScheduleTrigger
  if (draft.whenKind === 'every') {
    if (!Number.isFinite(draft.everyMinutes) || draft.everyMinutes < 1) {
      return { ok: false, error: 'An interval has to be at least one minute.' }
    }
    const notBefore = draft.notBefore.trim() ? parseTimeOfDay(draft.notBefore) : null
    if (draft.notBefore.trim() && !notBefore) return { ok: false, error: 'That start time is not a time.' }
    trigger = {
      kind: 'every',
      intervalMs: draft.everyMinutes * 60_000,
      notBeforeMs: notBefore ? nextOccurrenceOf(notBefore.hour, notBefore.minute, nowMs) : null
    }
  } else {
    const t = parseTimeOfDay(draft.timeOfDay)
    if (!t) return { ok: false, error: 'That time is not a time.' }
    trigger =
      draft.whenKind === 'daily'
        ? { kind: 'daily', hour: t.hour, minute: t.minute }
        : { kind: 'once', atMs: nextOccurrenceOf(t.hour, t.minute, nowMs) }
  }

  // A cap is meaningless for a one-shot and mandatory for anything recurring; the
  // store enforces the latter too, this just keeps the form from sending nonsense.
  const maxFirings =
    trigger.kind === 'once' ? null : Number.isFinite(draft.maxFirings) && draft.maxFirings > 0 ? draft.maxFirings : 10

  return {
    ok: true,
    create: { target, prompt, trigger, catchUp: draft.catchUp, maxFirings, stopOnFailure: true }
  }
}
