import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { Config } from '../config/schema'
import type { ResolvedCommand } from '../terminal/resolve-command'
import { REPOS, DIALOG, SHELLS, TOOLS, type RepoInfo, type ShellsInfo } from '../../shared/ipc'
import { listRepos } from '../config/repos'
import { shellsForPlatform, defaultShell } from '../terminal/shell'

export interface ComposerDeps {
  // Matches ConfigStore.config, which is null until the first successful load.
  getConfig: () => Config | null | undefined
  resolveCommand?: (command: string) => ResolvedCommand | undefined
}

// Agent CLI tools to offer in the New-tab menu. The default tool is always first
// (so the menu is never empty and Claude stays present even if the resolver
// hiccups); any other configured tool is included only when its command resolves
// on PATH, so Codex shows up automatically once it is installed and not before.
export function agentTools(
  config: Config,
  resolveCommand?: (command: string) => ResolvedCommand | undefined
): string[] {
  const def = config.defaultTool
  const out: string[] = []
  if (def && config.cliTools?.[def]) out.push(def)
  for (const name of Object.keys(config.cliTools ?? {})) {
    if (name === def) continue
    const cmd = config.cliTools[name]?.command
    const resolvable = cmd ? (resolveCommand ? resolveCommand(cmd) !== undefined : true) : false
    if (resolvable) out.push(name)
  }
  return out
}

// IPC for the inline composer's Folder field: the configured repos (quick-picks +
// ticket-prefix prefill) and a native directory picker. Read-only; no writes.
export function registerComposerIpc(deps: ComposerDeps): void {
  ipcMain.handle(REPOS.list, (): RepoInfo[] => {
    const cfg = deps.getConfig()
    return cfg ? listRepos(cfg) : []
  })

  ipcMain.handle(DIALOG.pickFolder, async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
    const res = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })

  ipcMain.handle(SHELLS.list, (): ShellsInfo => ({ shells: shellsForPlatform(), default: defaultShell() }))

  ipcMain.handle(TOOLS.list, (): string[] => {
    const cfg = deps.getConfig()
    return cfg ? agentTools(cfg, deps.resolveCommand) : []
  })
}
