import { homedir } from 'node:os'
import type { Config } from '../config/schema'

export function resolveCwd(config: Config, ticketKey?: string, cwdOverride?: string): string {
  if (cwdOverride && cwdOverride.trim()) return cwdOverride
  if (ticketKey) {
    // Match the Jira project segment (before the dash), not a bare string prefix,
    // so repo key "AB" does not capture ticket "ABC-1".
    const project = ticketKey.split('-')[0].toUpperCase()
    const repo = config.repos.find((r) => r.key.toUpperCase() === project)
    if (repo) return repo.path
  }
  return homedir()
}
