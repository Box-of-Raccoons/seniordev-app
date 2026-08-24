import type { Config } from '../config/schema'
import { findRepoForPath } from '../config/repos'

// Which gate command applies to a folder (supervision slice 2). Resolution:
// the matching repo's own `gate`, then the global `defaultGate`, then nothing.
//
// Empty is the meaningful default: the app must never invent a command to run
// inside somebody's repo, so configuring a gate is the whole opt-in.
export function gateCommandFor(config: Config, cwd: string): string {
  // No folder means no session to gate. Falling through to defaultGate here
  // would run it in whatever working directory the app happened to inherit.
  if (!cwd) return ''
  const repo = findRepoForPath(config, cwd)
  return repo?.gate || config.defaultGate || ''
}
