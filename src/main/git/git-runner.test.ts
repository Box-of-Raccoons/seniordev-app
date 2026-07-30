import { describe, it, expect } from 'vitest'
import { worktreePathSegment, worktreePathFor } from './git-runner'

describe('worktreePathSegment', () => {
  it('flattens slashes so a prefixed branch is one directory', () => {
    expect(worktreePathSegment('feature/foo')).toBe('feature-foo')
  })
})

describe('worktreePathFor', () => {
  it('builds <configDir>/worktrees/<repoKey>/<branch-segment>', () => {
    const p = worktreePathFor('/cfg', 'myrepo', 'hardy/add-thing')
    // node:path join — assert the tail structure without hardcoding the separator.
    expect(p.replace(/\\/g, '/')).toBe('/cfg/worktrees/myrepo/hardy-add-thing')
  })
  it('sanitizes a repoKey that contains path separators', () => {
    const p = worktreePathFor('/cfg', 'a/b', 'x')
    expect(p.replace(/\\/g, '/')).toBe('/cfg/worktrees/a-b/x')
  })
})
