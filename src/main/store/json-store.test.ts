import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadJson, writeJsonAtomic, debounce, createJsonStore, type VersionedDoc } from './json-store'

interface Doc extends VersionedDoc {
  items: string[]
}

// Migrate a raw on-disk value to the current v1 shape. undefined / corrupt / a
// legacy v0 doc all resolve to a valid v1 doc — the empty default when there is
// nothing usable to carry forward.
function migrate(raw: unknown): Doc {
  const o = (raw ?? {}) as Partial<Doc> & { items?: unknown }
  const items = Array.isArray(o.items) ? o.items.filter((x): x is string => typeof x === 'string') : []
  return { version: 1, items }
}

describe('loadJson / writeJsonAtomic', () => {
  let dir: string
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips a doc through disk', () => {
    dir = mkdtempSync(join(tmpdir(), 'store-'))
    const f = join(dir, 'd.json')
    writeJsonAtomic(f, { version: 1, items: ['a', 'b'] })
    expect(loadJson(f, migrate)).toEqual({ version: 1, items: ['a', 'b'] })
  })

  it('returns the migrate() default for a missing file', () => {
    dir = mkdtempSync(join(tmpdir(), 'store-'))
    expect(loadJson(join(dir, 'nope.json'), migrate)).toEqual({ version: 1, items: [] })
  })

  it('returns the migrate() default for malformed JSON', () => {
    dir = mkdtempSync(join(tmpdir(), 'store-'))
    const f = join(dir, 'd.json')
    writeFileSync(f, '{not json', 'utf8')
    expect(loadJson(f, migrate)).toEqual({ version: 1, items: [] })
  })

  it('migrates a legacy (version-less) doc on read', () => {
    dir = mkdtempSync(join(tmpdir(), 'store-'))
    const f = join(dir, 'd.json')
    // A pre-version doc: no `version`, items present. migrate() stamps v1.
    writeFileSync(f, JSON.stringify({ items: ['x'] }), 'utf8')
    expect(loadJson(f, migrate)).toEqual({ version: 1, items: ['x'] })
  })

  it('drops entries of the wrong type during migrate', () => {
    dir = mkdtempSync(join(tmpdir(), 'store-'))
    const f = join(dir, 'd.json')
    writeFileSync(f, JSON.stringify({ version: 1, items: ['ok', 3, null, 'yes'] }), 'utf8')
    expect(loadJson(f, migrate).items).toEqual(['ok', 'yes'])
  })

  it('writes atomically: no leftover .tmp after a write', () => {
    dir = mkdtempSync(join(tmpdir(), 'store-'))
    const f = join(dir, 'd.json')
    writeJsonAtomic(f, { version: 1, items: [] })
    expect(existsSync(`${f}.tmp`)).toBe(false)
  })

  it('swallows a write to an unwritable path (locked-dir stand-in)', () => {
    dir = mkdtempSync(join(tmpdir(), 'store-'))
    const asFile = join(dir, 'afile')
    writeFileSync(asFile, 'x', 'utf8')
    const bad = join(asFile, 'nested', 'd.json')
    expect(() => writeJsonAtomic(bad, { version: 1, items: [] })).not.toThrow()
  })
})

describe('debounce', () => {
  it('coalesces a burst into a single trailing call', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const d = debounce(fn, 500)
    d.trigger()
    d.trigger()
    d.trigger()
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(fn).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('flush() runs a pending call immediately and clears the timer', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const d = debounce(fn, 500)
    d.trigger()
    d.flush()
    expect(fn).toHaveBeenCalledTimes(1)
    // No second call when the (already-cleared) timer would have fired.
    vi.advanceTimersByTime(500)
    expect(fn).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('cancel() drops a pending call', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const d = debounce(fn, 500)
    d.trigger()
    d.cancel()
    vi.advanceTimersByTime(500)
    expect(fn).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('createJsonStore', () => {
  let dir: string
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('loads existing data on construction', () => {
    dir = mkdtempSync(join(tmpdir(), 'store-'))
    const f = join(dir, 'd.json')
    writeFileSync(f, JSON.stringify({ version: 1, items: ['seed'] }), 'utf8')
    const store = createJsonStore({ file: f, migrate })
    expect(store.get().items).toEqual(['seed'])
  })

  it('mutate() edits the live doc and flush() persists it', () => {
    dir = mkdtempSync(join(tmpdir(), 'store-'))
    const f = join(dir, 'd.json')
    const store = createJsonStore({ file: f, migrate, debounceMs: 500 })
    store.mutate((d) => d.items.push('one'))
    store.flush()
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual({ version: 1, items: ['one'] })
  })

  it('debounces persistence: a burst of mutate() writes once', () => {
    vi.useFakeTimers()
    dir = mkdtempSync(join(tmpdir(), 'store-'))
    const f = join(dir, 'd.json')
    const store = createJsonStore({ file: f, migrate, debounceMs: 500 })
    store.mutate((d) => d.items.push('a'))
    store.mutate((d) => d.items.push('b'))
    store.mutate((d) => d.items.push('c'))
    // Nothing on disk yet — still within the debounce window.
    expect(existsSync(f)).toBe(false)
    vi.advanceTimersByTime(500)
    expect(JSON.parse(readFileSync(f, 'utf8')).items).toEqual(['a', 'b', 'c'])
    vi.useRealTimers()
  })
})
