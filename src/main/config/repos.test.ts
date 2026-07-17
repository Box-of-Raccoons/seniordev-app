import { describe, it, expect } from 'vitest'
import { findRepoForTicket, listRepos } from './repos'
import type { Config } from './schema'

const config = {
  repos: [
    { key: 'SD', path: 'C:/repos/seniordev', branchPrefix: 'feature/' },
    { key: 'AB', path: 'C:/repos/ab', branchPrefix: '' }
  ]
} as unknown as Config

describe('findRepoForTicket', () => {
  it('matches the project segment case-insensitively', () => {
    expect(findRepoForTicket(config, 'sd-6')?.path).toBe('C:/repos/seniordev')
  })

  it('matches on the segment before the dash, not a bare prefix', () => {
    // "AB" must not capture "ABC-1"
    expect(findRepoForTicket(config, 'ABC-1')).toBeNull()
  })

  it('returns null when no repo matches', () => {
    expect(findRepoForTicket(config, 'ZZ-9')).toBeNull()
  })

  it('returns null for a key with no project segment', () => {
    expect(findRepoForTicket(config, '')).toBeNull()
  })
})

describe('listRepos', () => {
  it('maps configured repos to {key, path} quick-picks', () => {
    expect(listRepos(config)).toEqual([
      { key: 'SD', path: 'C:/repos/seniordev' },
      { key: 'AB', path: 'C:/repos/ab' }
    ])
  })

  it('is empty when no repos are configured', () => {
    expect(listRepos({ repos: [] } as unknown as Config)).toEqual([])
  })
})
