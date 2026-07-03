import { join } from 'node:path'
import type { Config } from './schema'
import type { Ticket } from '../../shared/types'
import { loadConfig } from './load'
import { defaultConfigDir } from './paths'
import { loadPrompts, type PromptTemplate } from '../prompts/library'
import { readContextFile } from '../prompts/files'
import { JiraClient } from '../jira/client'

// The minimal read surface IPC handlers depend on — lets tests hand in a plain
// object instead of a real store.
export interface ConfigSource {
  readonly config: Config | null
  readonly loadError: string | null
  readonly prompts: PromptTemplate[]
  getTicket(key: string): Promise<Ticket>
  contextTemplate?: () => string
}

export function requireConfig(src: ConfigSource): Config {
  if (!src.config) throw new Error(`Config not loaded: ${src.loadError ?? 'unknown error'}`)
  return src.config
}

// One user action can read the same ticket several times within seconds (open
// ticket → confirm-gate summary → classify), so getTicket memoizes briefly to
// make that cost a single Jira round-trip. Kept short so a re-opened ticket
// still shows fresh data.
export const TICKET_CACHE_MS = 30_000

// Mutable holder for everything derived from config.yaml. Handlers read it at
// call time, so reload() takes effect for NEW work without re-registration;
// running sessions copied their launch at spawn and are never touched.
export class ConfigStore implements ConfigSource {
  config: Config | null = null
  jiraClient: JiraClient | null = null
  readonly prompts: PromptTemplate[] = []
  loadError: string | null = null
  private readonly ticketCache = new Map<string, { at: number; ticket: Promise<Ticket> }>()

  constructor(readonly configPath: string) {}

  promptsDir(): string {
    return this.config?.promptsDir ?? join(defaultConfigDir(), 'prompts')
  }

  reload(): { ok: true } | { ok: false; error: string } {
    try {
      const cfg = loadConfig(this.configPath)
      this.config = cfg
      this.jiraClient = new JiraClient(cfg.jira)
      this.ticketCache.clear() // new credentials/base URL → cached tickets are suspect
      this.loadError = null
      this.reloadPrompts()
      return { ok: true }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      // Keep last-good: only surface a boot-level error when we never loaded.
      if (!this.config) this.loadError = error
      return { ok: false, error }
    }
  }

  reloadPrompts(): void {
    if (!this.config) return
    this.prompts.splice(0, this.prompts.length, ...loadPrompts(this.promptsDir()))
  }

  contextTemplate = (): string => readContextFile(this.promptsDir())

  getTicket = async (key: string): Promise<Ticket> => {
    if (!this.jiraClient) {
      throw new Error(`Config not loaded (${this.configPath}): ${this.loadError ?? 'unknown error'}`)
    }
    const k = key.toUpperCase()
    const hit = this.ticketCache.get(k)
    if (hit && Date.now() - hit.at <= TICKET_CACHE_MS) return hit.ticket
    const ticket = this.jiraClient.fetchIssue(key)
    this.ticketCache.set(k, { at: Date.now(), ticket })
    // A failure must not be served from cache — evict, but only if the entry is
    // still ours (a newer fetch may have replaced it).
    ticket.catch(() => {
      if (this.ticketCache.get(k)?.ticket === ticket) this.ticketCache.delete(k)
    })
    return ticket
  }
}
