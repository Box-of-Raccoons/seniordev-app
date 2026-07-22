import { describe, it, expect, vi } from 'vitest'
import { queryLoginPath, mergePath, fixedPath } from './fix-path'

const START = '__SD_PATH_START__'
const END = '__SD_PATH_END__'
const wrap = (path: string, noise = '') => `${noise}${START}${path}${END}`

describe('queryLoginPath', () => {
  it('extracts the PATH between delimiters, ignoring shell banner noise', () => {
    const exec = () => wrap('/Users/x/.local/bin:/usr/bin', 'Welcome banner\nmotd line\n')
    expect(queryLoginPath('/bin/zsh', exec)).toBe('/Users/x/.local/bin:/usr/bin')
  })

  it('invokes the shell as an interactive login shell (-ilc)', () => {
    const exec = vi.fn(() => wrap('/usr/bin'))
    queryLoginPath('/bin/zsh', exec)
    expect(exec).toHaveBeenCalledWith('/bin/zsh', expect.arrayContaining(['-ilc']))
  })

  it('returns undefined when the probe throws (never breaks startup)', () => {
    const exec = () => { throw new Error('shell blew up') }
    expect(queryLoginPath('/bin/zsh', exec)).toBeUndefined()
  })

  it('returns undefined when the shell yields an empty PATH', () => {
    expect(queryLoginPath('/bin/zsh', () => wrap(''))).toBeUndefined()
  })
})

describe('mergePath', () => {
  it('puts login entries first, then current, deduped and order-preserving', () => {
    // The user's real toolchain (login) must outrank the GUI-minimal current PATH.
    expect(mergePath('/usr/bin:/bin', '/Users/x/.local/bin:/usr/bin')).toBe(
      '/Users/x/.local/bin:/usr/bin:/bin'
    )
  })

  it('drops empty segments', () => {
    expect(mergePath('/bin:', ':/usr/bin:')).toBe('/usr/bin:/bin')
  })
})

describe('fixedPath', () => {
  it('is a no-op on win32 (GUI apps inherit PATH there)', () => {
    const exec = vi.fn()
    expect(fixedPath({ platform: 'win32', env: { PATH: '/x' }, exec })).toBeUndefined()
    expect(exec).not.toHaveBeenCalled()
  })

  it('returns undefined when the probe fails (keeps the existing PATH)', () => {
    const exec = () => { throw new Error('nope') }
    expect(fixedPath({ platform: 'darwin', env: { PATH: '/usr/bin' }, exec })).toBeUndefined()
  })

  // The actual bug: a Finder-launched app has a GUI-minimal PATH that omits the
  // dir holding `claude`, so node-pty can't spawn it → "[process exited: 1]".
  // The fix must fold the login shell's dir back in.
  it('recovers a tool dir missing from the GUI-minimal PATH', () => {
    const guiMinimal = '/usr/bin:/bin:/usr/sbin:/sbin'
    const exec = () => wrap('/Users/hardyspry/.local/bin:/opt/homebrew/bin:/usr/bin')
    const result = fixedPath({ platform: 'darwin', env: { PATH: guiMinimal, SHELL: '/bin/zsh' }, exec })
    expect(result).toContain('/Users/hardyspry/.local/bin')
    expect(result).not.toBe(guiMinimal)
    expect(result!.split(':')[0]).toBe('/Users/hardyspry/.local/bin')
  })

  it('falls back to /bin/zsh on darwin when SHELL is unset', () => {
    const exec = vi.fn(() => wrap('/usr/bin'))
    fixedPath({ platform: 'darwin', env: { PATH: '/usr/bin' }, exec })
    expect(exec).toHaveBeenCalledWith('/bin/zsh', expect.anything())
  })
})
