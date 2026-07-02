import { ipcMain } from 'electron'
import { STARTUP, type StartupOptions } from '../../shared/ipc'

export function registerStartupIpc(options: StartupOptions): void {
  ipcMain.handle(STARTUP.get, (): StartupOptions => options)
}
