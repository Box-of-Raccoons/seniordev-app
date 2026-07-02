import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { ConfigSchema, type Config } from './schema'
import { CLI_PRESETS, FORGE_PRESETS } from './presets'

type Dict = Record<string, unknown>

// Merge user entries onto presets per key AND per field, so overriding one
// field of a preset (e.g. cliTools.claude.command) keeps the preset's other
// fields (e.g. the safety-relevant yoloArgs) instead of silently dropping them.
function mergeByKey(presets: Record<string, Dict>, user: unknown): Dict {
  const out: Dict = { ...presets }
  const entries = user && typeof user === 'object' ? Object.entries(user as Dict) : []
  for (const [key, value] of entries) {
    const preset = presets[key]
    out[key] =
      preset && value && typeof value === 'object' && !Array.isArray(value)
        ? { ...preset, ...(value as Dict) }
        : value
  }
  return out
}

export function loadConfig(path: string): Config {
  const raw = (parse(readFileSync(path, 'utf8')) ?? {}) as Dict
  raw.cliTools = mergeByKey(CLI_PRESETS as unknown as Record<string, Dict>, raw.cliTools)
  raw.forges = mergeByKey(FORGE_PRESETS as unknown as Record<string, Dict>, raw.forges)
  return ConfigSchema.parse(raw)
}
