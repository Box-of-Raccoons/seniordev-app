import { join } from 'node:path'
import { defaultConfigDir } from '../config/paths'

// The persisted stores (spec section 4.1) live in the same config dir as
// config.yaml and recent-folders.json. Split by write frequency: workspace is
// rewritten on every tab move / pane resize, conversations on each launch / id
// capture, schedules once per firing, projects rarely. One combined file would
// rewrite the project list on every drag.
export function projectsPath(): string {
  return join(defaultConfigDir(), 'projects.json')
}

export function conversationsPath(): string {
  return join(defaultConfigDir(), 'conversations.json')
}

export function workspacePath(): string {
  return join(defaultConfigDir(), 'workspace.json')
}

export function schedulesPath(): string {
  return join(defaultConfigDir(), 'schedules.json')
}
