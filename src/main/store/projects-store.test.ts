import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProjectsStore, titleFromPath } from './projects-store'

describe('titleFromPath', () => {
  it('takes the basename across either separator', () => {
    expect(titleFromPath('/Users/h/code/gymtracker')).toBe('gymtracker')
    expect(titleFromPath('C:\\Users\\h\\code\\app')).toBe('app')
  })
  it('ignores a trailing separator', () => {
    expect(titleFromPath('/Users/h/code/app/')).toBe('app')
  })
})

describe('projects store', () => {
  let dir: string
  let file: string
  let clock: number
  const now = (): number => clock
  let n: number
  const newId = (): string => `id-${++n}`

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'projects-'))
    file = join(dir, 'projects.json')
    clock = 1000
    n = 0
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('auto-creates a project from a cwd, titled by basename', () => {
    const s = createProjectsStore({ file, now, newId })
    const p = s.ensureForCwd('/Users/h/code/gymtracker', { defaultTool: 'codex' })
    expect(p).toMatchObject({
      id: 'id-1',
      title: 'gymtracker',
      path: '/Users/h/code/gymtracker',
      defaultTool: 'codex',
      archivedAt: null,
      createdAt: 1000
    })
    expect(s.list()).toHaveLength(1)
  })

  it('dedupes by normalised path (idempotent, case + trailing slash)', () => {
    const s = createProjectsStore({ file, now, newId })
    const a = s.ensureForCwd('/Users/h/code/App')
    clock = 2000
    const b = s.ensureForCwd('/users/h/code/app/')
    expect(b.id).toBe(a.id)
    expect(s.list()).toHaveLength(1)
    // Re-activation bumps lastActiveAt but not createdAt.
    expect(b.lastActiveAt).toBe(2000)
    expect(b.createdAt).toBe(1000)
  })

  it('re-activating an archived project unarchives it', () => {
    const s = createProjectsStore({ file, now, newId })
    const p = s.ensureForCwd('/x/y')
    s.setArchived(p.id, true)
    expect(s.get(p.id)?.archivedAt).not.toBeNull()
    clock = 3000
    s.ensureForCwd('/x/y')
    expect(s.get(p.id)?.archivedAt).toBeNull()
  })

  it('separates active from archived', () => {
    const s = createProjectsStore({ file, now, newId })
    const a = s.ensureForCwd('/a')
    s.ensureForCwd('/b')
    s.setArchived(a.id, true)
    expect(s.active().map((p) => p.path)).toEqual(['/b'])
    expect(s.archived().map((p) => p.path)).toEqual(['/a'])
  })

  it('seeds from a recent-folders list, MRU-first (descending lastActiveAt), skipping blanks', () => {
    const s = createProjectsStore({ file, now, newId })
    const added = s.seedFromRecent(['/newest', '   ', '/older'], 'claude')
    expect(added).toBe(2)
    const byRecency = [...s.list()].sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    expect(byRecency.map((p) => p.path)).toEqual(['/newest', '/older'])
  })

  it('seedFromRecent is idempotent for already-known paths', () => {
    const s = createProjectsStore({ file, now, newId })
    s.ensureForCwd('/known')
    const added = s.seedFromRecent(['/known', '/fresh'], 'claude')
    expect(added).toBe(1)
    expect(s.list().map((p) => p.path).sort()).toEqual(['/fresh', '/known'])
  })

  it('persists across store instances (flush then reload)', () => {
    const s1 = createProjectsStore({ file, now, newId })
    s1.ensureForCwd('/persist/me')
    s1.flush()
    const s2 = createProjectsStore({ file, now, newId })
    expect(s2.list().map((p) => p.path)).toEqual(['/persist/me'])
  })

  it('recovers to empty from a corrupt file', () => {
    writeFileSync(file, '{bad json', 'utf8')
    const s = createProjectsStore({ file, now, newId })
    expect(s.list()).toEqual([])
  })
})
