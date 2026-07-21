import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addRecent, loadRecent, recordRecent } from './recent-folders'

describe('addRecent', () => {
  it('prepends the newest folder', () => {
    expect(addRecent(['a', 'b'], 'c')).toEqual(['c', 'a', 'b'])
  })

  it('moves an existing folder to the front (dedupe)', () => {
    expect(addRecent(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
  })

  it('dedupes case-insensitively', () => {
    expect(addRecent(['C:/Code/App'], 'c:/code/app')).toEqual(['c:/code/app'])
  })

  it('caps the list at the max (default 8)', () => {
    const start = ['1', '2', '3', '4', '5', '6', '7', '8']
    expect(addRecent(start, '9')).toEqual(['9', '1', '2', '3', '4', '5', '6', '7'])
  })

  it('trims and ignores a blank path', () => {
    expect(addRecent(['a'], '   ')).toEqual(['a'])
    expect(addRecent(['a'], '  b ')).toEqual(['b', 'a'])
  })
})

describe('loadRecent / recordRecent (file-backed)', () => {
  let dir: string
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('returns [] for a missing file', () => {
    dir = mkdtempSync(join(tmpdir(), 'recent-'))
    expect(loadRecent(join(dir, 'nope.json'))).toEqual([])
  })

  it('returns [] for malformed JSON', () => {
    dir = mkdtempSync(join(tmpdir(), 'recent-'))
    const f = join(dir, 'r.json')
    writeFileSync(f, '{not json', 'utf8')
    expect(loadRecent(f)).toEqual([])
  })

  it('returns [] when the shape is wrong', () => {
    dir = mkdtempSync(join(tmpdir(), 'recent-'))
    const f = join(dir, 'r.json')
    writeFileSync(f, JSON.stringify({ folders: 'not-an-array' }), 'utf8')
    expect(loadRecent(f)).toEqual([])
  })

  it('records to disk and reads back most-recent-first', () => {
    dir = mkdtempSync(join(tmpdir(), 'recent-'))
    const f = join(dir, 'r.json')
    recordRecent('/a', f)
    recordRecent('/b', f)
    expect(loadRecent(f)).toEqual(['/b', '/a'])
  })

  it('swallows a write to an unwritable path and still returns the computed list', () => {
    // A path whose parent is a file, not a directory, cannot be created/written —
    // stands in for a locked/redirected %APPDATA%. Must not throw.
    dir = mkdtempSync(join(tmpdir(), 'recent-'))
    const asFile = join(dir, 'afile')
    writeFileSync(asFile, 'x', 'utf8')
    const bad = join(asFile, 'nested', 'r.json')
    expect(() => recordRecent('/a', bad)).not.toThrow()
    expect(recordRecent('/a', bad)).toEqual(['/a'])
  })
})
