import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
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

  it('renames a corrupt file aside and reports the backup path (SD-9 low #1)', () => {
    writeFileSync(path, '{ broken json', 'utf8')
    const s = new WatchState(path)
    expect(s.corruptedBackupPath).toBe(`${path}.corrupt`)
    expect(existsSync(`${path}.corrupt`)).toBe(true)
    expect(readFileSync(`${path}.corrupt`, 'utf8')).toBe('{ broken json')
    expect(s.has('anything')).toBe(false)
    // The corrupt original was moved aside, so a subsequent boot is clean.
    expect(new WatchState(path).corruptedBackupPath).toBeNull()
  })

  it('writes valid JSON', () => {
    const s = new WatchState(path)
    s.record('SD-4', 'spawned', '2026-07-03T00:00:00.000Z')
    const data = JSON.parse(readFileSync(path, 'utf8'))
    expect(data.dispatched['SD-4']).toEqual({ at: '2026-07-03T00:00:00.000Z', outcome: 'spawned' })
  })
})
