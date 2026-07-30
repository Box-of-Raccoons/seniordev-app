import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  decodeUuidV7Ms,
  parseRolloutFilename,
  findRolloutSession,
  pollForCodexSession
} from './session-discovery'

// Real ids + timestamps captured from ~/.codex/state_5.sqlite on 2026-07-30.
const REAL = [
  { id: '019fac38-7f16-7f90-b118-c9ba0cef3d8d', ms: 1785300811542 },
  { id: '019fac17-07af-7e71-82e1-33546498d761', ms: 1785298618287 }
]

describe('decodeUuidV7Ms', () => {
  it('decodes the embedded ms from real codex ids (bit-identical to created_at_ms)', () => {
    for (const { id, ms } of REAL) expect(decodeUuidV7Ms(id)).toBe(ms)
  })
  it('returns null for a non-uuid string', () => {
    expect(decodeUuidV7Ms('not-a-uuid')).toBeNull()
    expect(decodeUuidV7Ms('')).toBeNull()
  })
})

describe('parseRolloutFilename', () => {
  it('extracts the trailing uuid + ts from a real rollout filename', () => {
    const name = `rollout-2026-07-29T00-53-31-${REAL[0].id}.jsonl`
    expect(parseRolloutFilename(name)).toEqual({ uuid: REAL[0].id, tsMs: REAL[0].ms })
  })
  it('ignores unrelated files', () => {
    expect(parseRolloutFilename('notes.txt')).toBeNull()
    expect(parseRolloutFilename('rollout-2026-07-29.jsonl')).toBeNull()
  })
})

// Build a fixture sessions tree: sessions/2026/07/29/rollout-...-<id>.jsonl whose
// first line is the session_meta record carrying cwd.
function writeRollout(sessionsDir: string, id: string, cwd: string, extraLines = 0): void {
  const day = join(sessionsDir, '2026', '07', '29')
  mkdirSync(day, { recursive: true })
  const meta = JSON.stringify({ type: 'session_meta', payload: { session_id: id, cwd, cli_version: '0.146.0' } })
  const lines = [meta, ...Array.from({ length: extraLines }, (_, i) => JSON.stringify({ type: 'event', n: i }))]
  writeFileSync(join(day, `rollout-2026-07-29T00-53-31-${id}.jsonl`), lines.join('\n') + '\n', 'utf8')
}

describe('findRolloutSession', () => {
  let dir: string
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('finds a session by cwd within the creation-time window', () => {
    dir = mkdtempSync(join(tmpdir(), 'codex-'))
    writeRollout(dir, REAL[0].id, '/Users/h/code')
    const id = findRolloutSession({ sessionsDir: dir, cwd: '/Users/h/code', since: REAL[0].ms - 1000, until: REAL[0].ms + 1000 })
    expect(id).toBe(REAL[0].id)
  })

  it('ignores a session outside the time window', () => {
    dir = mkdtempSync(join(tmpdir(), 'codex-'))
    writeRollout(dir, REAL[0].id, '/Users/h/code')
    const id = findRolloutSession({ sessionsDir: dir, cwd: '/Users/h/code', since: REAL[0].ms + 5000, until: REAL[0].ms + 9000 })
    expect(id).toBeNull()
  })

  it('ignores a session in a different cwd', () => {
    dir = mkdtempSync(join(tmpdir(), 'codex-'))
    writeRollout(dir, REAL[0].id, '/some/other/dir')
    const id = findRolloutSession({ sessionsDir: dir, cwd: '/Users/h/code', since: REAL[0].ms - 1000, until: REAL[0].ms + 1000 })
    expect(id).toBeNull()
  })

  it('matches cwd ignoring a trailing separator', () => {
    dir = mkdtempSync(join(tmpdir(), 'codex-'))
    writeRollout(dir, REAL[0].id, '/Users/h/code')
    const id = findRolloutSession({ sessionsDir: dir, cwd: '/Users/h/code/', since: REAL[0].ms - 1000, until: REAL[0].ms + 1000 })
    expect(id).toBe(REAL[0].id)
  })

  it('returns null for a missing sessions directory', () => {
    expect(findRolloutSession({ sessionsDir: '/no/such/dir/anywhere', cwd: '/x', since: 0, until: 1e15 })).toBeNull()
  })

  it('returns null (no match) when the first line is malformed', () => {
    dir = mkdtempSync(join(tmpdir(), 'codex-'))
    const day = join(dir, '2026', '07', '29')
    mkdirSync(day, { recursive: true })
    writeFileSync(join(day, `rollout-2026-07-29T00-53-31-${REAL[0].id}.jsonl`), '{not json\n', 'utf8')
    const id = findRolloutSession({ sessionsDir: dir, cwd: '/Users/h/code', since: REAL[0].ms - 1000, until: REAL[0].ms + 1000 })
    expect(id).toBeNull()
  })

  it('picks the newest cwd-matching session when several are in window', () => {
    dir = mkdtempSync(join(tmpdir(), 'codex-'))
    writeRollout(dir, REAL[1].id, '/Users/h/code') // older
    writeRollout(dir, REAL[0].id, '/Users/h/code') // newer
    const id = findRolloutSession({ sessionsDir: dir, cwd: '/Users/h/code', since: REAL[1].ms - 1000, until: REAL[0].ms + 1000 })
    expect(id).toBe(REAL[0].id) // REAL[0].ms > REAL[1].ms
  })
})

describe('pollForCodexSession', () => {
  let dir: string
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('returns the id as soon as the rollout file exists', async () => {
    dir = mkdtempSync(join(tmpdir(), 'codex-'))
    writeRollout(dir, REAL[0].id, '/Users/h/code')
    // now() anchored near the real id ts so the window covers it.
    const id = await pollForCodexSession({
      sessionsDir: dir,
      cwd: '/Users/h/code',
      since: REAL[0].ms,
      now: () => REAL[0].ms + 100,
      intervalMs: 5,
      timeoutMs: 100
    })
    expect(id).toBe(REAL[0].id)
  })

  it('times out to null when no file ever appears', async () => {
    dir = mkdtempSync(join(tmpdir(), 'codex-'))
    // A clock that jumps past the deadline on the second read → one retry, then null.
    let t = REAL[0].ms
    const id = await pollForCodexSession({
      sessionsDir: dir,
      cwd: '/Users/h/code',
      since: REAL[0].ms,
      now: () => (t += 10_000),
      sleep: async () => {},
      intervalMs: 1,
      timeoutMs: 20
    })
    expect(id).toBeNull()
  })
})
