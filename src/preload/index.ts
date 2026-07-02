import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type GetTicketResult } from '../shared/ipc'

const api = {
  getTicket: (key: string): Promise<GetTicketResult> => ipcRenderer.invoke(IPC.getTicket, key)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
