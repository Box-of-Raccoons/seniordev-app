import { ipcMain } from 'electron'
import { IPC, type RepoResolution } from '../../shared/ipc'

// Sync, read-only lookup: the composer uses this to prefill the Folder from a
// detected ticket key's mapped repo (config.repos).
export function registerReposIpc(resolveRepo: (key: string) => RepoResolution): void {
  ipcMain.handle(IPC.resolveRepo, (_e, key: string): RepoResolution => resolveRepo(key))
}
