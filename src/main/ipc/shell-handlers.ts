import { ipcMain, shell } from 'electron'
import { SHELL } from '../../shared/ipc'

export function registerShellIpc(): void {
  ipcMain.handle(SHELL.openExternal, async (_e, url: string): Promise<{ ok: boolean }> => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return { ok: false }
    await shell.openExternal(url)
    return { ok: true }
  })
}
