import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, TERM, PROMPTS, SHELL, STARTUP, YOLO, MENU, APP, type GetTicketResult, type PromptSummary } from '../shared/ipc'
import type { SpawnTerminalRequest, SpawnResult, TerminalDataEvent, TerminalExitEvent } from '../shared/ipc'
import type { StartYoloRequest, YoloCaps, YoloLogEvent, YoloPrEvent, YoloExitEvent } from '../shared/ipc'
import type { MenuAction, AppInfo } from '../shared/ipc'

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
  startYolo: (req: StartYoloRequest): Promise<SpawnResult> => ipcRenderer.invoke(YOLO.start, req),
  killYolo: (id: string): void => ipcRenderer.send(YOLO.kill, id),
  yoloCaps: (): Promise<YoloCaps> => ipcRenderer.invoke(YOLO.caps),
  onYoloLog: (cb: (e: YoloLogEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: YoloLogEvent): void => cb(payload)
    ipcRenderer.on(YOLO.log, listener)
    return () => ipcRenderer.off(YOLO.log, listener)
  },
  onYoloPr: (cb: (e: YoloPrEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: YoloPrEvent): void => cb(payload)
    ipcRenderer.on(YOLO.pr, listener)
    return () => ipcRenderer.off(YOLO.pr, listener)
  },
  onYoloExit: (cb: (e: YoloExitEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: YoloExitEvent): void => cb(payload)
    ipcRenderer.on(YOLO.exit, listener)
    return () => ipcRenderer.off(YOLO.exit, listener)
  },
  onMenuAction: (cb: (action: MenuAction) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, action: MenuAction): void => cb(action)
    ipcRenderer.on(MENU.action, listener)
    return () => ipcRenderer.off(MENU.action, listener)
  },
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(APP.info)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
