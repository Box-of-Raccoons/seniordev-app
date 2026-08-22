import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSchedulesStore, DEFAULT_MAX_FIRINGS } from './schedules-store'

const HOUR = 3600_000

describe('schedules store', () => {
  let dir: string
  let file: string
  let clock: number
  let seq: number
  const now = (): number => clock
  const newId = (): string => `s${++seq}`

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sched-'))
    file = join(dir, 'schedules.json')
    clock = 1000
    seq = 0
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('creates a schedule due at its first slot after creation', () => {
    const s = createSchedulesStore({ file, now, newId })
    const created = s.create({
      target: { kind: 'conversation', conversationId: 'c1' },
      prompt: 'continue',
      trigger: { kind: 'every', intervalMs: HOUR, notBeforeMs: null }
    })
    expect(created).toMatchObject({ id: 's1', enabled: true, firedCount: 0, createdAt: 1000 })
    expect(created.nextDueAt).toBe(1000 + HOUR)
  })

  it('lands a once schedule for a time already past as disabled, with a reason', () => {
    const s = createSchedulesStore({ file, now, newId })
    const created = s.create({
      target: { kind: 'conversation', conversationId: 'c1' },
      prompt: 'continue',
      trigger: { kind: 'once', atMs: 500 } // before the clock
    })
    expect(created.enabled).toBe(false)
    expect(created.lastReason).toMatch(/already passed/)
  })

  it('forces a firing cap onto a recurring schedule that was given none', () => {
    const s = createSchedulesStore({ file, now, newId })
    const recurring = s.create({
      target: { kind: 'conversation', conversationId: 'c1' },
      prompt: 'poll',
      trigger: { kind: 'every', intervalMs: HOUR, notBeforeMs: null },
      maxFirings: null
    })
    // An uncapped recurring schedule aimed at a YOLO launch is an unbounded burn.
    expect(recurring.maxFirings).toBe(DEFAULT_MAX_FIRINGS)
    // A one-shot legitimately has no cap to enforce.
    const once = s.create({
      target: { kind: 'conversation', conversationId: 'c1' },
      prompt: 'continue',
      trigger: { kind: 'once', atMs: 5000 },
      maxFirings: null
    })
    expect(once.maxFirings).toBeNull()
  })

  it('titles an untitled schedule from the head of its prompt', () => {
    const s = createSchedulesStore({ file, now, newId })
    expect(s.create({ target: { kind: 'conversation', conversationId: 'c1' }, prompt: 'run the tests\nthen stop', trigger: { kind: 'once', atMs: 5000 } }).title).toBe('run the tests')
    expect(s.create({ target: { kind: 'conversation', conversationId: 'c1' }, prompt: '   ', trigger: { kind: 'once', atMs: 5000 } }).title).toBe('Untitled schedule')
  })

  it('finds the schedules bound to a conversation, ignoring launch schedules', () => {
    const s = createSchedulesStore({ file, now, newId })
    s.create({ target: { kind: 'conversation', conversationId: 'c1' }, prompt: 'a', trigger: { kind: 'once', atMs: 5000 } })
    s.create({ target: { kind: 'conversation', conversationId: 'c2' }, prompt: 'b', trigger: { kind: 'once', atMs: 5000 } })
    s.create({ target: { kind: 'launch', session: { mode: 'interactive', folder: '/x' } }, prompt: 'c', trigger: { kind: 'once', atMs: 5000 } })
    expect(s.byConversation('c1').map((x) => x.prompt)).toEqual(['a'])
  })

  it('writes back the run state a firing produced', () => {
    const s = createSchedulesStore({ file, now, newId })
    const c = s.create({ target: { kind: 'conversation', conversationId: 'c1' }, prompt: 'go', trigger: { kind: 'every', intervalMs: HOUR, notBeforeMs: null } })
    s.recordOutcome(c.id, {
      enabled: true,
      firedCount: 1,
      nextDueAt: 9999,
      lastFiredAt: 1234,
      lastOutcome: 'fired',
      lastReason: null,
      deferredSinceAt: null
    })
    expect(s.get(c.id)).toMatchObject({ firedCount: 1, nextDueAt: 9999, lastOutcome: 'fired' })
  })

  it('ignores an outcome for a schedule that was deleted mid-firing', () => {
    const s = createSchedulesStore({ file, now, newId })
    expect(() =>
      s.recordOutcome('gone', {
        enabled: true, firedCount: 1, nextDueAt: 1, lastFiredAt: 1, lastOutcome: 'fired', lastReason: null, deferredSinceAt: null
      })
    ).not.toThrow()
  })

  it('moves a re-enabled schedule to its next real slot instead of firing at once', () => {
    const s = createSchedulesStore({ file, now, newId })
    const c = s.create({ target: { kind: 'conversation', conversationId: 'c1' }, prompt: 'go', trigger: { kind: 'every', intervalMs: HOUR, notBeforeMs: null } })
    s.setEnabled(c.id, false)
    clock = 1000 + 10 * HOUR // its slot went by while disabled
    s.setEnabled(c.id, true)
    expect(s.get(c.id)?.nextDueAt).toBeGreaterThan(clock)
  })

  it('disables a re-enabled once schedule whose moment is gone', () => {
    const s = createSchedulesStore({ file, now, newId })
    const c = s.create({ target: { kind: 'conversation', conversationId: 'c1' }, prompt: 'go', trigger: { kind: 'once', atMs: 5000 } })
    s.setEnabled(c.id, false)
    clock = 60_000
    s.setEnabled(c.id, true)
    expect(s.get(c.id)?.enabled).toBe(false)
  })

  it('removes a schedule', () => {
    const s = createSchedulesStore({ file, now, newId })
    const c = s.create({ target: { kind: 'conversation', conversationId: 'c1' }, prompt: 'go', trigger: { kind: 'once', atMs: 5000 } })
    s.remove(c.id)
    expect(s.list()).toHaveLength(0)
  })

  it('persists across instances', () => {
    const a = createSchedulesStore({ file, now, newId })
    a.create({ target: { kind: 'conversation', conversationId: 'c1' }, prompt: 'go', trigger: { kind: 'once', atMs: 5000 } })
    a.flush()
    const b = createSchedulesStore({ file, now, newId })
    expect(b.list()).toHaveLength(1)
    expect(b.list()[0].prompt).toBe('go')
  })

  it('drops records whose trigger or target cannot be understood, keeping the rest', () => {
    // A schedule with an unparseable trigger would otherwise fire at an unknown
    // time; dropping it is the only safe reading.
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        schedules: [
          { id: 'ok', target: { kind: 'conversation', conversationId: 'c1' }, trigger: { kind: 'once', atMs: 5000 }, prompt: 'p' },
          { id: 'bad-trigger', target: { kind: 'conversation', conversationId: 'c1' }, trigger: { kind: 'cron', expr: '0 5 * * *' }, prompt: 'p' },
          { id: 'bad-target', target: { kind: 'conversation' }, trigger: { kind: 'once', atMs: 5000 }, prompt: 'p' },
          { id: 'no-interval', target: { kind: 'conversation', conversationId: 'c1' }, trigger: { kind: 'every', intervalMs: 0 }, prompt: 'p' },
          { target: { kind: 'conversation', conversationId: 'c1' }, trigger: { kind: 'once', atMs: 5000 }, prompt: 'p' }
        ]
      }),
      'utf8'
    )
    const s = createSchedulesStore({ file, now, newId })
    expect(s.list().map((x) => x.id)).toEqual(['ok'])
  })

  it('degrades a corrupt store to empty rather than throwing', () => {
    writeFileSync(file, 'not json at all', 'utf8')
    const s = createSchedulesStore({ file, now, newId })
    expect(s.list()).toEqual([])
  })

  it('caps an uncapped recurring schedule found on disk', () => {
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        schedules: [{ id: 'x', target: { kind: 'conversation', conversationId: 'c1' }, trigger: { kind: 'every', intervalMs: HOUR }, prompt: 'p', maxFirings: null }]
      }),
      'utf8'
    )
    const s = createSchedulesStore({ file, now, newId })
    expect(s.list()[0].maxFirings).toBe(DEFAULT_MAX_FIRINGS)
  })

  it('round-trips a launch target through disk', () => {
    const a = createSchedulesStore({ file, now, newId })
    a.create({
      target: { kind: 'launch', session: { mode: 'yolo', folder: '/repo', tool: 'claude', promptText: 'do the thing' }, ticket: 'GG-1' },
      prompt: 'do the thing',
      trigger: { kind: 'daily', hour: 5, minute: 0 }
    })
    a.flush()
    expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(1)
    const b = createSchedulesStore({ file, now, newId })
    const t = b.list()[0].target
    expect(t.kind).toBe('launch')
    expect(t.kind === 'launch' && t.session.mode).toBe('yolo')
    expect(t.kind === 'launch' && t.ticket).toBe('GG-1')
  })
})
