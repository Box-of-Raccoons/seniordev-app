import { describe, it, expect } from 'vitest'
import { computeArchivals } from './archive'
import type { Project } from './store/projects-store'

const DAY = 86_400_000
const NOW = 1_000_000_000_000

function project(over: Partial<Project> & { id: string }): Project {
  return {
    id: over.id,
    title: over.title ?? over.id,
    path: over.path ?? `/repo/${over.id}`,
    defaultTool: 'claude',
    worktreeDefault: false,
    lastActiveAt: over.lastActiveAt ?? NOW,
    archivedAt: over.archivedAt ?? null,
    createdAt: NOW,
    updatedAt: NOW
  }
}

describe('computeArchivals (spec 4.5)', () => {
  const none = new Set<string>()

  it('archives a project idle longer than the threshold', () => {
    const projects = [project({ id: 'old', lastActiveAt: NOW - 20 * DAY })]
    expect(computeArchivals({ projects, now: NOW, archiveAfterDays: 14, liveProjectIds: none })).toEqual(['old'])
  })

  it('keeps a project active within the threshold', () => {
    const projects = [project({ id: 'fresh', lastActiveAt: NOW - 3 * DAY })]
    expect(computeArchivals({ projects, now: NOW, archiveAfterDays: 14, liveProjectIds: none })).toEqual([])
  })

  it('never archives a project with a live tab, even if idle', () => {
    const projects = [project({ id: 'live', lastActiveAt: NOW - 30 * DAY })]
    const live = new Set(['live'])
    expect(computeArchivals({ projects, now: NOW, archiveAfterDays: 14, liveProjectIds: live })).toEqual([])
  })

  it('never re-archives an already-archived project', () => {
    const projects = [project({ id: 'gone', lastActiveAt: NOW - 30 * DAY, archivedAt: NOW - 10 * DAY })]
    expect(computeArchivals({ projects, now: NOW, archiveAfterDays: 14, liveProjectIds: none })).toEqual([])
  })

  it('archiveAfterDays = 0 disables archiving entirely', () => {
    const projects = [project({ id: 'ancient', lastActiveAt: NOW - 400 * DAY })]
    expect(computeArchivals({ projects, now: NOW, archiveAfterDays: 0, liveProjectIds: none })).toEqual([])
  })

  it('sorts nothing but returns every qualifying project', () => {
    const projects = [
      project({ id: 'a', lastActiveAt: NOW - 20 * DAY }),
      project({ id: 'b', lastActiveAt: NOW - 1 * DAY }),
      project({ id: 'c', lastActiveAt: NOW - 15 * DAY })
    ]
    expect(computeArchivals({ projects, now: NOW, archiveAfterDays: 14, liveProjectIds: none }).sort()).toEqual(['a', 'c'])
  })
})
