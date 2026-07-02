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
})
