import { describe, it, expect } from 'vitest'
import { homedir } from 'node:os'
import { resolveCwd } from './resolve'
import type { Config } from '../config/schema'

const cfg = {
  repos: [{ key: 'PROJ', path: 'C:/code/backend', branchPrefix: 'feature/' }]
} as unknown as Config

describe('resolveCwd', () => {
  it('maps a ticket key prefix to the repo path', () => {
    expect(resolveCwd(cfg, 'PROJ-123')).toBe('C:/code/backend')
  })
  it('is case-insensitive on the key', () => {
    expect(resolveCwd(cfg, 'proj-9')).toBe('C:/code/backend')
  })
  it('prefers an explicit cwdOverride', () => {
    expect(resolveCwd(cfg, 'PROJ-1', 'D:/elsewhere')).toBe('D:/elsewhere')
  })
  it('falls back to homedir for an unmapped ticket', () => {
    expect(resolveCwd(cfg, 'NOPE-1')).toBe(homedir())
  })
  it('falls back to homedir when no ticket is given', () => {
    expect(resolveCwd(cfg)).toBe(homedir())
  })
  it('does not over-match a repo key that is only a string prefix', () => {
    const c = { repos: [{ key: 'AB', path: 'C:/ab', branchPrefix: '' }] } as unknown as Config
    // 'ABC-1' project segment is 'ABC', not 'AB' -> no match -> homedir
    expect(resolveCwd(c, 'ABC-1')).toBe(homedir())
  })
  it('matches the exact project segment regardless of repo order', () => {
    const c = {
      repos: [
        { key: 'PR', path: 'C:/pr', branchPrefix: '' },
        { key: 'PROJ', path: 'C:/proj', branchPrefix: '' }
      ]
    } as unknown as Config
    expect(resolveCwd(c, 'PROJ-1')).toBe('C:/proj')
    expect(resolveCwd(c, 'PR-9')).toBe('C:/pr')
  })
})
