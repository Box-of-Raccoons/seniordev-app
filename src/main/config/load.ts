import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { ConfigSchema, type Config } from './schema'
import { CLI_PRESETS, FORGE_PRESETS } from './presets'

export function loadConfig(path: string): Config {
  const raw = (parse(readFileSync(path, 'utf8')) ?? {}) as Record<string, unknown>
  raw.cliTools = { ...CLI_PRESETS, ...((raw.cliTools as object) ?? {}) }
  raw.forges = { ...FORGE_PRESETS, ...((raw.forges as object) ?? {}) }
  return ConfigSchema.parse(raw)
}
