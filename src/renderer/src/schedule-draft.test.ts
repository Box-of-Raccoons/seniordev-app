import { describe, it, expect } from 'vitest'
import { buildCreate, emptyDraft, nextOccurrenceOf, type ScheduleDraft } from './schedule-draft'

const NOW = new Date(2026, 7, 21, 1, 0, 0, 0).getTime() // 21 Aug 2026, 01:00 local

function draft(over: Partial<ScheduleDraft> = {}): ScheduleDraft {
  return { ...emptyDraft(), prompt: 'continue', conversationId: 'c1', ...over }
}

const unwrap = (r: ReturnType<typeof buildCreate>): { target: unknown; trigger: unknown; maxFirings: unknown } => {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`)
  return r.create as never
}

describe('nextOccurrenceOf', () => {
  it('picks today when the time is still ahead, tomorrow once it has gone', () => {
    expect(nextOccurrenceOf(5, 0, NOW)).toBe(new Date(2026, 7, 21, 5, 0, 0, 0).getTime())
    const afterFive = new Date(2026, 7, 21, 6, 0, 0, 0).getTime()
    expect(nextOccurrenceOf(5, 0, afterFive)).toBe(new Date(2026, 7, 22, 5, 0, 0, 0).getTime())
  })
})

describe('buildCreate — refusals', () => {
  it('refuses a schedule with nothing to say', () => {
    expect(buildCreate(draft({ prompt: '   ' }), NOW)).toEqual({ ok: false, error: 'Give it a prompt to deliver.' })
  })

  it('refuses a conversation schedule with no conversation', () => {
    const r = buildCreate(draft({ conversationId: '' }), NOW)
    expect(r.ok).toBe(false)
  })

  it('refuses a launch with no folder', () => {
    // An agent CLI gates on trusting an unknown directory, and that gate would
    // swallow the prompt — so this is a real refusal, not tidiness.
    const r = buildCreate(draft({ targetKind: 'launch', folder: '  ' }), NOW)
    expect(r).toEqual({ ok: false, error: 'Pick the folder the new session should run in.' })
  })

  it('refuses a sub-minute or nonsense interval', () => {
    expect(buildCreate(draft({ whenKind: 'every', everyMinutes: 0 }), NOW).ok).toBe(false)
    expect(buildCreate(draft({ whenKind: 'every', everyMinutes: Number.NaN }), NOW).ok).toBe(false)
  })

  it('refuses a time that is not a time', () => {
    expect(buildCreate(draft({ whenKind: 'daily', timeOfDay: '25:00' }), NOW).ok).toBe(false)
    expect(buildCreate(draft({ whenKind: 'daily', timeOfDay: 'soon' }), NOW).ok).toBe(false)
    expect(buildCreate(draft({ whenKind: 'every', everyMinutes: 30, notBefore: 'dawn' }), NOW).ok).toBe(false)
  })
})

describe('buildCreate — triggers', () => {
  it('reads a daily time as local hour and minute, not a timestamp', () => {
    // Storing the wall time is what holds 5am across a DST shift.
    expect(unwrap(buildCreate(draft({ whenKind: 'daily', timeOfDay: '05:00' }), NOW)).trigger).toEqual({
      kind: 'daily',
      hour: 5,
      minute: 0
    })
  })

  it('resolves a once time to the NEXT occurrence, never one already gone', () => {
    expect(unwrap(buildCreate(draft({ whenKind: 'once', timeOfDay: '05:00' }), NOW)).trigger).toEqual({
      kind: 'once',
      atMs: new Date(2026, 7, 21, 5, 0, 0, 0).getTime()
    })
  })

  it('turns an interval into ms, with an optional earliest start', () => {
    expect(unwrap(buildCreate(draft({ whenKind: 'every', everyMinutes: 30 }), NOW)).trigger).toEqual({
      kind: 'every',
      intervalMs: 1_800_000,
      notBeforeMs: null
    })
    const gated = unwrap(buildCreate(draft({ whenKind: 'every', everyMinutes: 30, notBefore: '05:00' }), NOW))
      .trigger as { notBeforeMs: number }
    expect(gated.notBeforeMs).toBe(new Date(2026, 7, 21, 5, 0, 0, 0).getTime())
  })
})

describe('buildCreate — caps and targets', () => {
  it('drops the cap for a one-shot and keeps one for anything recurring', () => {
    expect(unwrap(buildCreate(draft({ whenKind: 'once' }), NOW)).maxFirings).toBeNull()
    expect(unwrap(buildCreate(draft({ whenKind: 'daily', maxFirings: 5 }), NOW)).maxFirings).toBe(5)
    // A recurring schedule can never end up uncapped, whatever the field says.
    expect(unwrap(buildCreate(draft({ whenKind: 'daily', maxFirings: 0 }), NOW)).maxFirings).toBe(10)
  })

  it('carries the yolo flag and the folder into the launch session', () => {
    const t = unwrap(buildCreate(draft({ targetKind: 'launch', folder: '/repo', yolo: true, tool: 'claude' }), NOW))
      .target as { kind: string; session: { mode: string; folder: string; tool: string; promptText: string } }
    expect(t.kind).toBe('launch')
    expect(t.session).toMatchObject({ mode: 'yolo', folder: '/repo', tool: 'claude', promptText: 'continue' })
  })

  it('always sets stopOnFailure, so a broken schedule retires itself', () => {
    const r = buildCreate(draft(), NOW)
    expect(r.ok && r.create.stopOnFailure).toBe(true)
  })
})

describe('buildCreate — model', () => {
  it('carries an explicit model into the launch session', () => {
    const t = unwrap(buildCreate(draft({ targetKind: 'launch', folder: '/repo', model: 'claude-haiku-4-5' }), NOW))
      .target as { session: { model?: string } }
    expect(t.session.model).toBe('claude-haiku-4-5')
  })

  it('omits the model entirely when left blank, rather than sending an empty one', () => {
    // Blank means "whatever the tool would pick", which IS the absent-model
    // behaviour; sending '' would look like a deliberate choice downstream.
    const t = unwrap(buildCreate(draft({ targetKind: 'launch', folder: '/repo', model: '   ' }), NOW))
      .target as { session: { model?: string } }
    expect('model' in t.session).toBe(false)
  })

  it('trims a pasted model id', () => {
    const t = unwrap(buildCreate(draft({ targetKind: 'launch', folder: '/repo', model: ' claude-opus-5 ' }), NOW))
      .target as { session: { model?: string } }
    expect(t.session.model).toBe('claude-opus-5')
  })

  it('never puts a model on a conversation target, which cannot use one', () => {
    // An existing session already has its model; a resume drops model args by
    // design (session.ts), so offering one there would be a lie.
    const r = buildCreate(draft({ targetKind: 'conversation', model: 'claude-opus-5' }), NOW)
    expect(r.ok && r.create.target.kind).toBe('conversation')
    expect(JSON.stringify(r.ok && r.create.target)).not.toContain('claude-opus-5')
  })
})
