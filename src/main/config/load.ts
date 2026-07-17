import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { ConfigSchema, type Config } from './schema'
import { CLI_PRESETS, FORGE_PRESETS } from './presets'

type Dict = Record<string, unknown>

// Merge user entries onto presets per key AND per field, so overriding one
// field of a preset (e.g. cliTools.claude.command) keeps the preset's other
// fields (e.g. the safety-relevant headless args) instead of silently dropping them.
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

export function parseConfig(rawText: string): Config {
  const raw = (parse(rawText) ?? {}) as Dict
  raw.cliTools = mergeByKey(CLI_PRESETS as unknown as Record<string, Dict>, raw.cliTools)
  raw.forges = mergeByKey(FORGE_PRESETS as unknown as Record<string, Dict>, raw.forges)
  return ConfigSchema.parse(raw)
}

export function loadConfig(path: string): Config {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    // A missing config file is the normal clean-install / first-run state, not an
    // error: fall back to an empty config so every preset default (the claude/codex
    // cliTools, the github forge, defaultTool 'claude') applies and boot succeeds.
    // Without this, reload() throws → the caller's boot gate skips prompt-seeding and
    // leaves config null, so tools/repos/prompts all come back empty on a fresh install.
    // A malformed (non-ENOENT) file is a real problem and still surfaces.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return parseConfig('')
    throw err
  }
  return parseConfig(raw)
}
