import { join } from 'node:path'
import type { Config } from './schema'
import { loadConfig } from './load'
import { defaultConfigDir } from './paths'
import { loadPrompts, type PromptTemplate } from '../prompts/library'

// The minimal read surface IPC handlers depend on — lets tests hand in a plain
// object instead of a real store.
export interface ConfigSource {
  readonly config: Config | null
  readonly loadError: string | null
  readonly prompts: PromptTemplate[]
}

export function requireConfig(src: ConfigSource): Config {
  if (!src.config) throw new Error(`Config not loaded: ${src.loadError ?? 'unknown error'}`)
  return src.config
}

// Mutable holder for everything derived from config.yaml. Handlers read it at
// call time, so reload() takes effect for NEW work without re-registration;
// running sessions copied their launch at spawn and are never touched.
export class ConfigStore implements ConfigSource {
  config: Config | null = null
  readonly prompts: PromptTemplate[] = []
  loadError: string | null = null

  constructor(readonly configPath: string) {}

  promptsDir(): string {
    return this.config?.promptsDir ?? join(defaultConfigDir(), 'prompts')
  }

  reload(): { ok: true } | { ok: false; error: string } {
    try {
      this.config = loadConfig(this.configPath)
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
}
