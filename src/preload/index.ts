import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, TERM, PROMPTS, SHELL, STARTUP, type GetTicketResult, type PromptSummary } from '../shared/ipc'
import type { SpawnTerminalRequest, SpawnResult, TerminalDataEvent, TerminalExitEvent, TerminalPrEvent } from '../shared/ipc'

const api = {
  getTicket: (key: string): Promise<GetTicketResult> => ipcRenderer.invoke(IPC.getTicket, key),
  listPrompts: (): Promise<PromptSummary[]> => ipcRenderer.invoke(PROMPTS.list),

  spawnTerminal: (req: SpawnTerminalRequest): Promise<SpawnResult> => ipcRenderer.invoke(TERM.spawn, req),
  writeTerminal: (id: string, data: string): void => ipcRenderer.send(TERM.write, id, data),
  resizeTerminal: (id: string, cols: number, rows: number): void => ipcRenderer.send(TERM.resize, id, cols, rows),
  killTerminal: (id: string): void => ipcRenderer.send(TERM.kill, id),
  onTerminalData: (cb: (e: TerminalDataEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: TerminalDataEvent): void => cb(payload)
    ipcRenderer.on(TERM.data, listener)
    return () => ipcRenderer.off(TERM.data, listener)
  },
  onTerminalExit: (cb: (e: TerminalExitEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: TerminalExitEvent): void => cb(payload)
    ipcRenderer.on(TERM.exit, listener)
    return () => ipcRenderer.off(TERM.exit, listener)
  },
  openExternal: (url: string): Promise<{ ok: boolean }> => ipcRenderer.invoke(SHELL.openExternal, url),
  getStartup: (): Promise<import('../shared/ipc').StartupOptions> => ipcRenderer.invoke(STARTUP.get),
  onTerminalPr: (cb: (e: TerminalPrEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: TerminalPrEvent): void => cb(payload)
    ipcRenderer.on(TERM.pr, listener)
    return () => ipcRenderer.off(TERM.pr, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
