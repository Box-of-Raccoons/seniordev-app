import { ipcMain } from 'electron'
import type { Ticket } from '../../shared/types'
import { IPC, type GetTicketResult, type RepoResolution } from '../../shared/ipc'

export function registerIpc(
  getTicket: (key: string) => Promise<Ticket>,
  resolveRepo: (key: string) => RepoResolution
): void {
  ipcMain.handle(IPC.getTicket, async (_e, key: string): Promise<GetTicketResult> => {
    try {
      const ticket = await getTicket(key)
      return { ok: true, ticket }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  // Sync, read-only lookup: the deep-link YOLO confirm gate uses this to show the
  // resolved repo (or refuse when a project maps to nothing) — see SD-9 S2.
  ipcMain.handle(IPC.resolveRepo, (_e, key: string): RepoResolution => resolveRepo(key))
}
