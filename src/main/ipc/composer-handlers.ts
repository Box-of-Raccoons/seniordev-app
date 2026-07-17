import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { Config } from '../config/schema'
import { REPOS, DIALOG, SHELLS, type RepoInfo, type ShellsInfo } from '../../shared/ipc'
import { listRepos } from '../config/repos'
import { shellsForPlatform, defaultShell } from '../terminal/shell'

export interface ComposerDeps {
  // Matches ConfigStore.config, which is null until the first successful load.
  getConfig: () => Config | null | undefined
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
}
