import { describe, it, expect } from 'vitest'
import { PrCollector, buildForgePatterns } from './pr-detector'
import type { Config } from '../config/schema'

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

describe('PrCollector', () => {
  const patterns = [
    { term: 'PR', regex: new RegExp('https://github\\.com/[^/\\s]+/[^/\\s]+/pull/\\d+') }
  ]
  it('collects multiple distinct PRs in order', () => {
    const c = new PrCollector(patterns)
    expect(c.feed('see https://github.com/a/b/pull/1 and\n')).toEqual([
      { url: 'https://github.com/a/b/pull/1', term: 'PR' }
    ])
    expect(c.feed('also https://github.com/a/c/pull/2\n')).toEqual([
      { url: 'https://github.com/a/c/pull/2', term: 'PR' }
    ])
    expect(c.urls).toEqual(['https://github.com/a/b/pull/1', 'https://github.com/a/c/pull/2'])
  })
  it('dedupes a URL seen twice', () => {
    const c = new PrCollector(patterns)
    c.feed('https://github.com/a/b/pull/1\n')
    expect(c.feed('again https://github.com/a/b/pull/1\n')).toEqual([])
    expect(c.urls).toEqual(['https://github.com/a/b/pull/1'])
  })
  it('finds a URL split across two feeds', () => {
    const c = new PrCollector(patterns)
    expect(c.feed('https://github.com/a/b/pu')).toEqual([])
    expect(c.feed('ll/7 done\n')).toEqual([{ url: 'https://github.com/a/b/pull/7', term: 'PR' }])
  })
})
