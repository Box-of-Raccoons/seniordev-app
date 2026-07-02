import { describe, it, expect } from 'vitest'
import { PrDetector, buildForgePatterns, type ForgePattern } from './pr-detector'
import type { Config } from '../config/schema'

const patterns: ForgePattern[] = [
  { term: 'PR', regex: /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/ },
  { term: 'MR', regex: /https:\/\/gitlab\.com\/.+\/-\/merge_requests\/\d+/ }
]

describe('PrDetector', () => {
  it('detects a github PR url and its term, once', () => {
    const d = new PrDetector(patterns)
    expect(d.feed('working...\n')).toBeNull()
    const hit = d.feed('Created https://github.com/org/repo/pull/42\n')
    expect(hit).toEqual({ url: 'https://github.com/org/repo/pull/42', term: 'PR' })
    expect(d.feed('https://github.com/org/repo/pull/99')).toBeNull() // already found
  })
  it('detects a url split across two chunks', () => {
    const d = new PrDetector(patterns)
    expect(d.feed('see https://github.com/org/re')).toBeNull()
    expect(d.feed('po/pull/7 done')).toEqual({ url: 'https://github.com/org/repo/pull/7', term: 'PR' })
  })
  it('labels gitlab MRs with the MR term', () => {
    const d = new PrDetector(patterns)
    expect(d.feed('https://gitlab.com/g/p/-/merge_requests/3')?.term).toBe('MR')
  })
})

describe('buildForgePatterns', () => {
  it('compiles configured forge urlPatterns and skips invalid ones', () => {
    const cfg = {
      forges: {
        github: { prCommand: '', term: 'PR', urlPattern: 'https://github\\.com/[^/]+/[^/]+/pull/\\d+' },
        bad: { prCommand: '', term: 'X', urlPattern: '(' }
      }
    } as unknown as Config
    const ps = buildForgePatterns(cfg)
    expect(ps).toHaveLength(1)
    expect(ps[0].term).toBe('PR')
    expect('https://github.com/o/r/pull/1').toMatch(ps[0].regex)
  })
}
)
