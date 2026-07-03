import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WatchState } from './state'

let path: string
beforeEach(() => { path = join(mkdtempSync(join(tmpdir(), 'sd-watch-')), 'watch-state.json') })

describe('WatchState', () => {
  it('records and reports dispatched keys, persisting across instances', () => {
    const s = new WatchState(path)
    expect(s.has('SD-1')).toBe(false)
    s.record('SD-1', 'spawned', '2026-07-03T00:00:00.000Z')
    expect(s.has('SD-1')).toBe(true)
    // A fresh instance reads the file back.
    expect(new WatchState(path).has('SD-1')).toBe(true)
  })

  it('clear() removes a key (retry path)', () => {
    const s = new WatchState(path)
    s.record('SD-2', 'failed', 'now')
    s.clear('SD-2')
    expect(s.has('SD-2')).toBe(false)
  })

  it('persists autoMode independently of config', () => {
    const s = new WatchState(path)
    expect(s.getAutoMode()).toBeUndefined()
    s.setAutoMode(true)
    expect(new WatchState(path).getAutoMode()).toBe(true)
  })

  it('tolerates a missing or corrupt file', () => {
    // Missing file:
    expect(new WatchState(path).has('x')).toBe(false)
    // Corrupt file:
    const s = new WatchState(path)
    s.record('SD-3', 'spawned', 'now')
    require('node:fs').writeFileSync(path, 'not json', 'utf8')
    expect(new WatchState(path).has('SD-3')).toBe(false)
  })

  it('writes valid JSON', () => {
    const s = new WatchState(path)
    s.record('SD-4', 'spawned', '2026-07-03T00:00:00.000Z')
    const data = JSON.parse(readFileSync(path, 'utf8'))
    expect(data.dispatched['SD-4']).toEqual({ at: '2026-07-03T00:00:00.000Z', outcome: 'spawned' })
  })
})
