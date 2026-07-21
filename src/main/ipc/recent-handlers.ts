import { ipcMain } from 'electron'
import { RECENT } from '../../shared/ipc'
import { loadRecent, recordRecent } from '../recent-folders'

// The composer reads the MRU list on mount (list) and the app records a folder on
// every launch (record, fire-and-forget). record is best-effort — see
// recent-folders.ts: a write failure never throws, so a launch is never blocked.
export function registerRecentIpc(): void {
  ipcMain.handle(RECENT.list, (): string[] => loadRecent())
  ipcMain.on(RECENT.record, (_e, path: string): void => {
    recordRecent(path)
  })
}
