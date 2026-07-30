import { createJsonStore, type JsonStore, type VersionedDoc } from './json-store'
import { projectsPath } from './paths'

// A project is a first-class entity, not a cwd string (spec section 2 goal 2,
// section 4.1). Auto-created from the launch folder; never deleted, only archived.
export interface Project {
  id: string
  title: string
  path: string
  defaultTool: string
  worktreeDefault: boolean
  lastActiveAt: number
  archivedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface ProjectsDoc extends VersionedDoc {
  version: 1
  projects: Project[]
}

// Directory basename, tolerant of either separator and a trailing slash, so a
// title is stable whether the path came from Windows or POSIX. Mirrors the
// renderer's basename() in RightPanel.
export function titleFromPath(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
}

// Dedupe key for a project path: trimmed, trailing separators removed,
// lower-cased (case-insensitive, matching recent-folders' dedupe). Two launches
// into the same folder must resolve to one project.
function normPath(p: string): string {
  return p.trim().replace(/[\\/]+$/, '').toLowerCase()
}

function migrateProjects(raw: unknown): ProjectsDoc {
  const o = (raw ?? {}) as { projects?: unknown }
  const list = Array.isArray(o.projects) ? o.projects : []
  const projects: Project[] = []
  for (const item of list) {
    const p = item as Partial<Project>
    if (typeof p?.id !== 'string' || typeof p?.path !== 'string') continue
    projects.push({
      id: p.id,
      title: typeof p.title === 'string' ? p.title : titleFromPath(p.path),
      path: p.path,
      defaultTool: typeof p.defaultTool === 'string' ? p.defaultTool : 'claude',
      worktreeDefault: p.worktreeDefault === true,
      lastActiveAt: typeof p.lastActiveAt === 'number' ? p.lastActiveAt : 0,
      archivedAt: typeof p.archivedAt === 'number' ? p.archivedAt : null,
      createdAt: typeof p.createdAt === 'number' ? p.createdAt : 0,
      updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : 0
    })
  }
  return { version: 1, projects }
}

export interface ProjectsStore {
  list(): Project[]
  active(): Project[]
  archived(): Project[]
  get(id: string): Project | undefined
  // Find the project for a folder, creating it (auto-bootstrap, section 4.5) if
  // none exists; either way bump lastActiveAt so the sidebar can sort by recency.
  ensureForCwd(path: string, opts?: { defaultTool?: string }): Project
  setArchived(id: string, archived: boolean): void
  // First-run seed from recent-folders.json so the sidebar is not empty on day
  // one (section 4.4). Idempotent: only paths without an existing project are
  // added. Preserves MRU order via a descending lastActiveAt.
  seedFromRecent(paths: string[], defaultTool: string): number
  flush(): void
}

function crypto_randomUUID(): string {
  return (globalThis.crypto as { randomUUID(): string }).randomUUID()
}

export function createProjectsStore(deps?: {
  file?: string
  now?: () => number
  newId?: () => string
}): ProjectsStore {
  const now = deps?.now ?? Date.now
  const newId = deps?.newId ?? crypto_randomUUID
  const store: JsonStore<ProjectsDoc> = createJsonStore({
    file: deps?.file ?? projectsPath(),
    migrate: migrateProjects
  })

  function findByPath(path: string): Project | undefined {
    const norm = normPath(path)
    return store.get().projects.find((p) => normPath(p.path) === norm)
  }

  return {
    list: () => store.get().projects,
    active: () => store.get().projects.filter((p) => p.archivedAt === null),
    archived: () => store.get().projects.filter((p) => p.archivedAt !== null),
    get: (id) => store.get().projects.find((p) => p.id === id),

    ensureForCwd(path, opts) {
      const existing = findByPath(path)
      const t = now()
      if (existing) {
        store.mutate(() => {
          existing.lastActiveAt = t
          existing.updatedAt = t
          // Re-activating an archived project (a new launch into it) unarchives it.
          existing.archivedAt = null
        })
        return existing
      }
      const created: Project = {
        id: newId(),
        title: titleFromPath(path),
        path,
        defaultTool: opts?.defaultTool ?? 'claude',
        worktreeDefault: false,
        lastActiveAt: t,
        archivedAt: null,
        createdAt: t,
        updatedAt: t
      }
      store.mutate((d) => d.projects.push(created))
      return created
    },

    setArchived(id, archived) {
      const proj = store.get().projects.find((p) => p.id === id)
      if (!proj) return
      const t = now()
      store.mutate(() => {
        proj.archivedAt = archived ? t : null
        proj.updatedAt = t
      })
    },

    seedFromRecent(paths, defaultTool) {
      const t = now()
      let added = 0
      // paths arrive MRU-first; give the newest the highest lastActiveAt so the
      // sidebar's recency sort matches the order the user last saw.
      paths.forEach((path, i) => {
        if (!path.trim() || findByPath(path)) return
        const ts = t - i
        store.mutate((d) =>
          d.projects.push({
            id: newId(),
            title: titleFromPath(path),
            path,
            defaultTool,
            worktreeDefault: false,
            lastActiveAt: ts,
            archivedAt: null,
            createdAt: ts,
            updatedAt: ts
          })
        )
        added += 1
      })
      return added
    },

    flush: () => store.flush()
  }
}
