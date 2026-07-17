import { homedir } from 'node:os'
import type { Config } from '../config/schema'
import { findRepoForTicket } from '../config/repos'

export function resolveCwd(config: Config, ticketKey?: string, cwdOverride?: string): string {
  if (cwdOverride && cwdOverride.trim()) return cwdOverride
  if (ticketKey) {
    const repo = findRepoForTicket(config, ticketKey)
    if (repo) return repo.path
  }
  return homedir()
}
