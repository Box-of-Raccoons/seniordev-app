import { describe, it, expect } from 'vitest'
import { findRepoForTicket } from './repo-map'
import { ConfigSchema, type Config } from '../main/config/schema'

const config: Config = ConfigSchema.parse({
  jira: { baseUrl: 'https://x.atlassian.net', email: 'a@b.co', apiToken: 't' },
  repos: [
    { key: 'SD', path: 'C:/repos/seniordev' },
    { key: 'AB', path: 'C:/repos/ab' }
  ]
})

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
})
