import { join } from 'node:path'
import { homedir } from 'node:os'

// Pure, injectable for tests:
export function configDir(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  home: string
): string {
  if (platform === 'win32') {
    return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'SeniorDev')
  }
  return join(home, '.config', 'SeniorDev')
}

// Wiring helper: configDir(process.platform, process.env, homedir())
export function defaultConfigDir(): string {
  return configDir(process.platform, process.env, homedir())
}
