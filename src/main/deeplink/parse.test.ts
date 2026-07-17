import { describe, it, expect } from 'vitest'
import { parseDeepLink, findDeepLinkArg, linksFromArgv } from './parse'

describe('parseDeepLink', () => {
  it('parses a valid open link', () => {
    expect(parseDeepLink('seniordev://open?ticket=SD-6')).toEqual({ action: 'open', ticket: 'SD-6' })
  })
  it('parses a valid yolo link', () => {
    expect(parseDeepLink('seniordev://yolo?ticket=SD-6')).toEqual({ action: 'yolo', ticket: 'SD-6' })
  })
  it('uppercases the ticket key', () => {
    expect(parseDeepLink('seniordev://open?ticket=sd-6')).toEqual({ action: 'open', ticket: 'SD-6' })
  })
  it('ignores extra query params', () => {
    expect(parseDeepLink('seniordev://yolo?prompt=fix&ticket=AB-12&x=1')).toEqual({ action: 'yolo', ticket: 'AB-12' })
  })
  it('carries optional role and folder prefill hints', () => {
    expect(parseDeepLink('seniordev://open?ticket=SD-6&role=fix-bug&folder=~/code/sd')).toEqual({
      action: 'open',
      ticket: 'SD-6',
      role: 'fix-bug',
      folder: '~/code/sd'
    })
  })
  it('drops a role that is not a prompt-name slug', () => {
    // "rm -rf" (space) is not a slug → role is ignored, ticket still parses.
    expect(parseDeepLink('seniordev://open?ticket=SD-6&role=rm%20-rf')).toEqual({ action: 'open', ticket: 'SD-6' })
  })
  it('rejects an unknown action', () => {
    expect(parseDeepLink('seniordev://delete?ticket=SD-6')).toBeNull()
  })
  it('rejects a missing ticket', () => {
    expect(parseDeepLink('seniordev://open')).toBeNull()
  })
  it('rejects a malformed ticket', () => {
    expect(parseDeepLink('seniordev://open?ticket=notaticket')).toBeNull()
  })
  it('rejects a garbage string', () => {
    expect(parseDeepLink('not a url at all')).toBeNull()
  })
})

describe('findDeepLinkArg', () => {
  it('picks the deep link out of a mixed argv', () => {
    const argv = ['C:/electron.exe', '--flag', 'seniordev://yolo?ticket=SD-6', 'PROJ-1']
    expect(findDeepLinkArg(argv)).toBe('seniordev://yolo?ticket=SD-6')
  })
  it('is case-insensitive on the scheme', () => {
    expect(findDeepLinkArg(['SeniorDev://open?ticket=SD-6'])).toBe('SeniorDev://open?ticket=SD-6')
  })
  it('returns undefined when absent', () => {
    expect(findDeepLinkArg(['C:/electron.exe', 'PROJ-1'])).toBeUndefined()
  })
})

describe('linksFromArgv', () => {
  it('an explicit deep link wins', () => {
    expect(linksFromArgv(['C:/electron.exe', 'seniordev://yolo?ticket=SD-6', 'PROJ-1'])).toEqual([
      { action: 'yolo', ticket: 'SD-6' }
    ])
  })
  it('plain ticket keys become open links (second-instance `seniordev PROJ-1`)', () => {
    expect(linksFromArgv(['C:/electron.exe', 'proj-1', 'AB-2'])).toEqual([
      { action: 'open', ticket: 'PROJ-1' },
      { action: 'open', ticket: 'AB-2' }
    ])
  })
  it('ignores flags and non-ticket args', () => {
    expect(linksFromArgv(['C:/electron.exe', '--yolo', 'not a ticket'])).toEqual([])
  })
  it('a malformed deep link falls back to ticket args', () => {
    expect(linksFromArgv(['seniordev://delete?ticket=SD-6', 'SD-7'])).toEqual([
      { action: 'open', ticket: 'SD-7' }
    ])
  })
})
