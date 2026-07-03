import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, TERM, PROMPTS, SHELL, STARTUP, YOLO, MENU, APP, CONFIG, PROMPT_FILES, DEEPLINK, ORCHESTRATOR, type GetTicketResult, type PromptSummary, type DeepLink } from '../shared/ipc'
import type { SpawnTerminalRequest, SpawnResult, TerminalDataEvent, TerminalExitEvent } from '../shared/ipc'
import type { StartYoloRequest, YoloCaps, YoloLogEvent, YoloPrEvent, YoloExitEvent } from '../shared/ipc'
import type { MenuAction, AppInfo, ConfigReadResult, SaveResult, RecapInfo, PreambleInfo, PromptReadResult } from '../shared/ipc'
import type { ClassifyRequest, ClassifyResult, OrchestratorPromptInfo } from '../shared/ipc'

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
  onDeepLink: (cb: (link: DeepLink) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: DeepLink): void => cb(payload)
    ipcRenderer.on(DEEPLINK.event, listener)
    return () => ipcRenderer.off(DEEPLINK.event, listener)
  },
  deepLinkReady: (): void => ipcRenderer.send(DEEPLINK.ready),
  onOrchestrate: (cb: (ticket: string) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, ticket: string): void => cb(ticket)
    ipcRenderer.on(ORCHESTRATOR.run, listener)
    return () => ipcRenderer.off(ORCHESTRATOR.run, listener)
  },
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(APP.info),
  readConfig: (): Promise<ConfigReadResult> => ipcRenderer.invoke(CONFIG.read),
  saveConfig: (text: string): Promise<SaveResult> => ipcRenderer.invoke(CONFIG.save, text),
  onConfigChanged: (cb: () => void): (() => void) => {
    const listener = (_e: IpcRendererEvent): void => cb()
    ipcRenderer.on(CONFIG.changed, listener)
    return () => ipcRenderer.off(CONFIG.changed, listener)
  },
  readRecap: (): Promise<RecapInfo> => ipcRenderer.invoke(CONFIG.readRecap),
  saveRecap: (text: string): Promise<SaveResult> => ipcRenderer.invoke(CONFIG.saveRecap, text),
  readPreamble: (): Promise<PreambleInfo> => ipcRenderer.invoke(CONFIG.readPreamble),
  savePreamble: (text: string): Promise<SaveResult> => ipcRenderer.invoke(CONFIG.savePreamble, text),

  readPrompt: (name: string): Promise<PromptReadResult> => ipcRenderer.invoke(PROMPT_FILES.read, name),
  writePrompt: (name: string, text: string): Promise<SaveResult> => ipcRenderer.invoke(PROMPT_FILES.write, name, text),
  createPrompt: (name: string): Promise<PromptReadResult> => ipcRenderer.invoke(PROMPT_FILES.create, name),
  deletePrompt: (name: string): Promise<SaveResult> => ipcRenderer.invoke(PROMPT_FILES.delete, name),
  readContext: (): Promise<PromptReadResult> => ipcRenderer.invoke(PROMPT_FILES.readContext),
  writeContext: (text: string): Promise<SaveResult> => ipcRenderer.invoke(PROMPT_FILES.writeContext, text),

  classifyTicket: (req: ClassifyRequest): Promise<ClassifyResult> => ipcRenderer.invoke(ORCHESTRATOR.classify, req),
  killClassify: (id: string): void => ipcRenderer.send(ORCHESTRATOR.kill, id),
  readOrchestratorPrompt: (): Promise<OrchestratorPromptInfo> => ipcRenderer.invoke(ORCHESTRATOR.readPrompt),
  saveOrchestratorPrompt: (text: string): Promise<SaveResult> => ipcRenderer.invoke(ORCHESTRATOR.savePrompt, text)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
