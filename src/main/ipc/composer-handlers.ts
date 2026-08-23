import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { Config } from '../config/schema'
import { REPOS, DIALOG, SHELLS, TOOLS, WORKSPACE, type RepoInfo, type ShellsInfo, type WorkspaceSettings } from '../../shared/ipc'
import { listRepos } from '../config/repos'
import { shellsForPlatform, defaultShell } from '../terminal/shell'

export interface ComposerDeps {
  // Matches ConfigStore.config, which is null until the first successful load.
  getConfig: () => Config | null | undefined
  // Whether a tool's command is installed on PATH — cross-platform, so Codex is
  // offered on macOS/Linux too (not just Windows). See systemCommandAvailable.
  isAvailable?: (command: string) => boolean
}

// Agent CLI tools to offer in the New-tab menu. The default tool is always first
// (so the menu is never empty and Claude stays present even if the check
// hiccups); any other configured tool is included only when its command is
// installed, so Codex shows up automatically once it is present and not before.
export function agentTools(
  config: Config,
  isAvailable?: (command: string) => boolean
): string[] {
  const def = config.defaultTool
  const out: string[] = []
  if (def && config.cliTools?.[def]) out.push(def)
  for (const name of Object.keys(config.cliTools ?? {})) {
    if (name === def) continue
    const cmd = config.cliTools[name]?.command
    const available = cmd ? (isAvailable ? isAvailable(cmd) : true) : false
    if (available) out.push(name)
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
    return cfg ? agentTools(cfg, deps.isAvailable) : []
  })

  // Suggestions for a per-launch model picker, keyed by tool. Empty before a
  // config loads, and empty per tool that lists none, which the form renders as
  // a plain text field rather than an empty dropdown.
  ipcMain.handle(TOOLS.models, (): Record<string, string[]> => {
    const cfg = deps.getConfig()
    if (!cfg) return {}
    return Object.fromEntries(Object.entries(cfg.cliTools).map(([name, t]) => [name, t.models ?? []]))
  })

  // Resolved layout scalars for the renderer's pane system. Falls back to the
  // schema default (320) when config hasn't loaded yet, so the renderer always
  // gets a usable minimum.
  ipcMain.handle(WORKSPACE.getSettings, (): WorkspaceSettings => {
    const cfg = deps.getConfig()
    return { minPaneWidth: cfg?.minPaneWidth ?? 320 }
  })
}
