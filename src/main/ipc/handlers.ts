import { ipcMain } from 'electron'
import type { Ticket } from '../../shared/types'
import { IPC, type GetTicketResult } from '../../shared/ipc'

export function registerIpc(getTicket: (key: string) => Promise<Ticket>): void {
  ipcMain.handle(IPC.getTicket, async (_e, key: string): Promise<GetTicketResult> => {
    try {
      const ticket = await getTicket(key)
      return { ok: true, ticket }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
