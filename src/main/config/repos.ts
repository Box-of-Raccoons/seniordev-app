import type { Config } from './schema'
import type { RepoInfo } from '../../shared/ipc'

export type Repo = Config['repos'][number]

// The serializable repo list the composer's folder field offers as quick-picks.
export function listRepos(config: Config): RepoInfo[] {
  return config.repos.map((r) => ({ key: r.key, path: r.path }))
}

// Match a ticket key to a configured repo by its Jira project segment (the part
// before the dash), case-insensitively — so repo key "AB" does not capture ticket
// "ABC-1". Returns null on a miss; callers decide whether to fall back (resolveCwd
// falls back to homedir; the deep-link gate refuses). This is the single source of
// truth for ticket -> repo mapping, shared by resolveCwd and the resolveRepo IPC.
export function findRepoForTicket(config: Config, ticketKey: string): Repo | null {
  const project = ticketKey.split('-')[0]?.toUpperCase()
  if (!project) return null
  return config.repos.find((r) => r.key.toUpperCase() === project) ?? null
}

// Normalize a folder path for a dedupe/equality comparison: trimmed, trailing
// separators dropped, lower-cased. Matches the projects-store dedupe so a folder
// resolves to the same repo/project regardless of a trailing slash or case.
export function normRepoPath(p: string): string {
  return p.trim().replace(/[\\/]+$/, '').toLowerCase()
}

// Match a launch folder to a configured repo by path (S5: to read its branchPrefix
// and use its key as the worktree directory name). Returns null when the folder is
// a git repo but not one the user has configured — then branchPrefix is empty and
// the folder basename names the worktree dir instead.
export function findRepoForPath(config: Config, folder: string): Repo | null {
  const norm = normRepoPath(folder)
  return config.repos.find((r) => normRepoPath(r.path) === norm) ?? null
}
