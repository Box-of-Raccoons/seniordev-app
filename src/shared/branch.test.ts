import { describe, it, expect } from 'vitest'
import { slugifyForBranch, sanitizeBranchRef } from './branch'

describe('slugifyForBranch', () => {
  it('lowercases and collapses non-alphanumeric runs to single dashes', () => {
    expect(slugifyForBranch('Add the New Widget!')).toBe('add-the-new-widget')
  })
  it('trims leading/trailing separators', () => {
    expect(slugifyForBranch('  --Fix bug--  ')).toBe('fix-bug')
  })
  it('caps length and never ends on a dash', () => {
    const out = slugifyForBranch('a'.repeat(80), 10)
    expect(out.length).toBeLessThanOrEqual(10)
    expect(out.endsWith('-')).toBe(false)
  })
  it('returns empty for a promptless input', () => {
    expect(slugifyForBranch('')).toBe('')
    expect(slugifyForBranch('   ')).toBe('')
  })
})

describe('sanitizeBranchRef', () => {
  it('keeps a valid prefixed branch, including the internal slash', () => {
    expect(sanitizeBranchRef('hardy/add-thing')).toBe('hardy/add-thing')
  })
  it('falls back to "task" when empty (empty prefix + empty slug)', () => {
    expect(sanitizeBranchRef('')).toBe('task')
    expect(sanitizeBranchRef('///')).toBe('task')
  })
  it('replaces forbidden metacharacters and whitespace', () => {
    expect(sanitizeBranchRef('feat: my thing~^?')).toBe('feat-my-thing')
  })
  it('collapses consecutive dots and doubled slashes', () => {
    expect(sanitizeBranchRef('a..b//c')).toBe('a.b/c')
  })
  it('strips a trailing .lock and trailing separators', () => {
    expect(sanitizeBranchRef('release.lock')).toBe('release')
    expect(sanitizeBranchRef('foo-/.')).toBe('foo')
  })
  it('removes the reserved @{ sequence', () => {
    const out = sanitizeBranchRef('branch@{0}')
    expect(out).not.toContain('@{')
    expect(out).toBe('branch-0}') // '}' alone is a legal ref char; only '@{' is reserved
  })
})
