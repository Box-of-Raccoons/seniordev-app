import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, TERM, PROMPTS, SHELL, REPOS, DIALOG, SHELLS, TOOLS, STARTUP, YOLO, MENU, APP, CONFIG, PROMPT_FILES, DEEPLINK, type PromptSummary, type DeepLink, type RepoResolution, type RepoInfo, type ShellsInfo } from '../shared/ipc'
import type { SpawnTerminalRequest, SpawnShellRequest, SpawnResult, TerminalDataEvent, TerminalExitEvent } from '../shared/ipc'
import type { StartYoloRequest, YoloCaps, YoloLogEvent, YoloPrEvent, YoloExitEvent } from '../shared/ipc'
import type { MenuAction, AppInfo, ConfigReadResult, SaveResult, RecapInfo, PreambleInfo, PromptReadResult } from '../shared/ipc'

const api = {
  resolveRepo: (key: string): Promise<RepoResolution> => ipcRenderer.invoke(IPC.resolveRepo, key),
  listRepos: (): Promise<RepoInfo[]> => ipcRenderer.invoke(REPOS.list),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke(DIALOG.pickFolder),
  listPrompts: (): Promise<PromptSummary[]> => ipcRenderer.invoke(PROMPTS.list),

  spawnTerminal: (req: SpawnTerminalRequest): Promise<SpawnResult> => ipcRenderer.invoke(TERM.spawn, req),
  spawnShell: (req: SpawnShellRequest): Promise<SpawnResult> => ipcRenderer.invoke(TERM.spawnShell, req),
  listShells: (): Promise<ShellsInfo> => ipcRenderer.invoke(SHELLS.list),
  listTools: (): Promise<string[]> => ipcRenderer.invoke(TOOLS.list),
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
  deletePrompt: (name: string): Promise<SaveResult> => ipcRenderer.invoke(PROMPT_FILES.delete, name)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
