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
