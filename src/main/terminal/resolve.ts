import { homedir } from 'node:os'
import type { Config } from '../config/schema'

export function resolveCwd(config: Config, ticketKey?: string, cwdOverride?: string): string {
  if (cwdOverride && cwdOverride.trim()) return cwdOverride
  if (ticketKey) {
    const key = ticketKey.toUpperCase()
    const repo = config.repos.find((r) => key.startsWith(r.key.toUpperCase()))
    if (repo) return repo.path
  }
  return homedir()
}
