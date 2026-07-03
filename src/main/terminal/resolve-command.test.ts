import { describe, it, expect } from 'vitest'
import { resolveCommandPath } from './resolve-command'

// Windows fs is case-insensitive; the fake mirrors that so PATHEXT casing
// (e.g. '.EXE') still matches a lowercased present path.
function fakeExists(present: string[]): (p: string) => boolean {
  const set = new Set(present.map((p) => p.toLowerCase()))
  return (p) => set.has(p.toLowerCase())
}

describe('resolveCommandPath', () => {
  it('finds a bare command as .exe via PATH + PATHEXT → kind exe', () => {
    const r = resolveCommandPath('foo', {
      path: 'C:\\bin',
      pathext: '.exe;.cmd',
      exists: fakeExists(['C:\\bin\\foo.exe'])
    })
    expect(r).toEqual({ path: 'C:\\bin\\foo.exe', kind: 'exe' })
  })

  it('finds a .cmd shim → kind shell', () => {
    const r = resolveCommandPath('foo', {
      path: 'C:\\bin',
      pathext: '.exe;.cmd',
      exists: fakeExists(['C:\\bin\\foo.cmd'])
    })
    expect(r).toEqual({ path: 'C:\\bin\\foo.cmd', kind: 'shell' })
  })

  it('PATH dir order beats PATHEXT order across dirs', () => {
    // .exe outranks .cmd in PATHEXT, but the .cmd sits in the earlier PATH dir.
    const r = resolveCommandPath('foo', {
      path: 'C:\\a;C:\\b',
      pathext: '.exe;.cmd',
      exists: fakeExists(['C:\\a\\foo.cmd', 'C:\\b\\foo.exe'])
    })
    expect(r).toEqual({ path: 'C:\\a\\foo.cmd', kind: 'shell' })
  })

  it('respects PATHEXT order within a single dir', () => {
    const r = resolveCommandPath('foo', {
      path: 'C:\\a',
      pathext: '.cmd;.exe',
      exists: fakeExists(['C:\\a\\foo.exe', 'C:\\a\\foo.cmd'])
    })
    expect(r).toEqual({ path: 'C:\\a\\foo.cmd', kind: 'shell' })
  })

  it('strips surrounding double quotes from a PATH entry', () => {
    const r = resolveCommandPath('foo', {
      path: '"C:\\a"',
      pathext: '.exe',
      exists: fakeExists(['C:\\a\\foo.exe'])
    })
    expect(r).toEqual({ path: 'C:\\a\\foo.exe', kind: 'exe' })
  })

  it('takes an absolute path with a .cmd extension verbatim (no PATH search)', () => {
    const r = resolveCommandPath('C:\\tools\\foo.cmd', {
      path: 'C:\\bin',
      pathext: '.exe;.cmd',
      exists: fakeExists(['C:\\tools\\foo.cmd'])
    })
    expect(r).toEqual({ path: 'C:\\tools\\foo.cmd', kind: 'shell' })
  })

  it('returns kind none when nothing matches anywhere', () => {
    const r = resolveCommandPath('foo', {
      path: 'C:\\a',
      pathext: '.exe',
      exists: fakeExists([])
    })
    expect(r).toEqual({ path: 'foo', kind: 'none' })
  })

  it('falls back to the default PATHEXT when the string is empty', () => {
    // .BAT is only in the default set, so a hit proves the default was used.
    const r = resolveCommandPath('foo', {
      path: 'C:\\a',
      pathext: '',
      exists: fakeExists(['C:\\a\\foo.bat'])
    })
    // The candidate keeps the default PATHEXT's casing (.BAT); Windows fs is
    // case-insensitive, so compare case-insensitively like the fs would.
    expect(r.kind).toBe('shell')
    expect(r.path.toLowerCase()).toBe('c:\\a\\foo.bat')
  })

  it('classifies a .com match as kind exe', () => {
    const r = resolveCommandPath('foo', {
      path: 'C:\\a',
      pathext: '.com',
      exists: fakeExists(['C:\\a\\foo.com'])
    })
    expect(r).toEqual({ path: 'C:\\a\\foo.com', kind: 'exe' })
  })

  it('matches PATHEXT case-insensitively', () => {
    const r = resolveCommandPath('foo', {
      path: 'C:\\a',
      pathext: '.EXE',
      exists: fakeExists(['C:\\a\\foo.exe'])
    })
    expect(r.kind).toBe('exe')
    expect(r.path.toLowerCase()).toBe('c:\\a\\foo.exe')
  })
})
