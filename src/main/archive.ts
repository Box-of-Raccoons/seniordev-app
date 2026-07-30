import type { Project } from './store/projects-store'

const MS_PER_DAY = 86_400_000

// Which projects to archive (spec section 4.5): those idle longer than
// archiveAfterDays, excluding ones already archived and ones with a live tab.
// Pure — the caller supplies now, the threshold, and the live set; archiving is
// reversible (sets archivedAt, deletes nothing) and 0 days disables it entirely.
export function computeArchivals(opts: {
  projects: Project[]
  now: number
  archiveAfterDays: number
  liveProjectIds: ReadonlySet<string>
}): string[] {
  if (opts.archiveAfterDays <= 0) return [] // 0 (or less) disables archiving
  const cutoff = opts.now - opts.archiveAfterDays * MS_PER_DAY
  return opts.projects
    .filter((p) => p.archivedAt === null) // not already archived
    .filter((p) => !opts.liveProjectIds.has(p.id)) // never archive a live project
    .filter((p) => p.lastActiveAt < cutoff) // idle past the threshold
    .map((p) => p.id)
}
