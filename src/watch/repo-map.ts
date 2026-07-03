import type { Config } from '../main/config/schema'

// Mirrors resolveCwd's project-segment match (terminal/resolve.ts) but reports a
// miss as null instead of falling back to homedir — the watcher must SKIP a
// ticket with no configured repo, not run it in the wrong place.
export function findRepoForTicket(config: Config, ticketKey: string): Config['repos'][number] | null {
  const project = ticketKey.split('-')[0]?.toUpperCase()
  if (!project) return null
  return config.repos.find((r) => r.key.toUpperCase() === project) ?? null
}
