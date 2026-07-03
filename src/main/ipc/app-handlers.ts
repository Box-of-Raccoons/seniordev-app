import { app, ipcMain } from 'electron'
import { APP, type AppInfo } from '../../shared/ipc'

export function registerAppIpc(): void {
  ipcMain.handle(APP.info, (): AppInfo => ({ name: app.getName(), version: app.getVersion() }))
}
