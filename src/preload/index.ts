import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, TERM, PROMPTS, SHELL, REPOS, DIALOG, RECENT, CLIPBOARD, SHELLS, TOOLS, WORKSPACE, STARTUP, YOLO, MENU, APP, CONFIG, PROMPT_FILES, DEEPLINK, STATUS, PROJECTS, CONVERSATIONS, SIDEBAR, WORKTREE, REVIEW, UPDATE, type ReviewTreeInfo, type ReviewDiffInfo, type PromptSummary, type DeepLink, type RepoResolution, type RepoInfo, type ShellsInfo, type WorkspaceSettings } from '../shared/ipc'
import type { SpawnTerminalRequest, SpawnShellRequest, SpawnResult, TerminalDataEvent, TerminalExitEvent, WorkspaceLayout } from '../shared/ipc'
import type { ProjectInfo, ConversationInfo, SidebarState } from '../shared/ipc'
import type { WorktreeInfo, WorktreeCreateRequest, WorktreeCreateResult, WorktreeTeardownRequest, WorktreeTeardownResult } from '../shared/ipc'
import type { StartYoloRequest, YoloCaps, YoloLogEvent, YoloPrEvent, YoloExitEvent } from '../shared/ipc'
import type { StatusUpdateEvent } from '../shared/ipc'
import { SUBAGENTS, SCHEDULES } from '../shared/ipc'
import type { ScheduledResume, ScheduleResumeDropped } from '../shared/ipc'
import type { Schedule, ScheduleCreate } from '../shared/ipc'
import type { SubagentSpawnEvent, SubagentActivityEvent, SubagentDoneEvent } from '../shared/ipc'
import type { UpdateInfo } from '../shared/ipc'
import type { MenuAction, AppInfo, ConfigReadResult, SaveResult, RecapInfo, PreambleInfo, PromptReadResult, WarmStartup } from '../shared/ipc'

const api = {
  resolveRepo: (key: string): Promise<RepoResolution> => ipcRenderer.invoke(IPC.resolveRepo, key),
  listRepos: (): Promise<RepoInfo[]> => ipcRenderer.invoke(REPOS.list),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke(DIALOG.pickFolder),
  listRecentFolders: (): Promise<string[]> => ipcRenderer.invoke(RECENT.list),
  recordRecentFolder: (path: string): void => ipcRenderer.send(RECENT.record, path),
  clipboardReadText: (): Promise<string> => ipcRenderer.invoke(CLIPBOARD.readText),
  clipboardWriteText: (text: string): void => ipcRenderer.send(CLIPBOARD.writeText, text),
  listPrompts: (): Promise<PromptSummary[]> => ipcRenderer.invoke(PROMPTS.list),

  spawnTerminal: (req: SpawnTerminalRequest): Promise<SpawnResult> => ipcRenderer.invoke(TERM.spawn, req),
  spawnShell: (req: SpawnShellRequest): Promise<SpawnResult> => ipcRenderer.invoke(TERM.spawnShell, req),
  listShells: (): Promise<ShellsInfo> => ipcRenderer.invoke(SHELLS.list),
  listTools: (): Promise<string[]> => ipcRenderer.invoke(TOOLS.list),
  listToolModels: (): Promise<Record<string, string[]>> => ipcRenderer.invoke(TOOLS.models),
  getWorkspaceSettings: (): Promise<WorkspaceSettings> => ipcRenderer.invoke(WORKSPACE.getSettings),
  saveWorkspace: (layout: WorkspaceLayout): void => ipcRenderer.send(WORKSPACE.save, layout),
  // S4 Projects sidebar: read the persisted projects/conversations + sidebar
  // geometry, restore an archived project, and subscribe to the change nudge.
  listProjects: (): Promise<ProjectInfo[]> => ipcRenderer.invoke(PROJECTS.list),
  listConversations: (): Promise<ConversationInfo[]> => ipcRenderer.invoke(CONVERSATIONS.list),
  setProjectArchived: (id: string, archived: boolean): Promise<void> => ipcRenderer.invoke(PROJECTS.setArchived, id, archived),
  // S6: create/refresh a project from a picked folder (New Project); restore an
  // archived conversation.
  ensureProject: (folder: string): Promise<ProjectInfo> => ipcRenderer.invoke(PROJECTS.ensure, folder),
  setConversationArchived: (id: string, archived: boolean): Promise<void> => ipcRenderer.invoke(CONVERSATIONS.setArchived, id, archived),
  getSidebarState: (): Promise<SidebarState> => ipcRenderer.invoke(WORKSPACE.getSidebar),
  setSuppressTeardownConfirm: (v: boolean): Promise<void> => ipcRenderer.invoke(WORKSPACE.setSuppressTeardownConfirm, v),
  onSidebarChanged: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(SIDEBAR.changed, listener)
    return () => ipcRenderer.off(SIDEBAR.changed, listener)
  },
  // S5 worktree toggle: the composer asks whether a folder is a git repo (+ its
  // branchPrefix + the remembered choice), pre-flight-creates a worktree before
  // launching, and the sidebar tears one down on archive.
  worktreeInfo: (folder: string): Promise<WorktreeInfo> => ipcRenderer.invoke(WORKTREE.info, folder),
  createWorktree: (req: WorktreeCreateRequest): Promise<WorktreeCreateResult> => ipcRenderer.invoke(WORKTREE.create, req),
  teardownConversation: (req: WorktreeTeardownRequest): Promise<WorktreeTeardownResult> => ipcRenderer.invoke(WORKTREE.teardown, req),
  // Supervision slice 1: read-only review of uncommitted work, keyed by working
  // tree. Neither call mutates anything.
  listReview: (): Promise<ReviewTreeInfo[]> => ipcRenderer.invoke(REVIEW.list),
  reviewDiff: (cwd: string, path: string | null): Promise<ReviewDiffInfo> => ipcRenderer.invoke(REVIEW.diff, cwd, path),
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
  // S1 status: the renderer reports its buffer as active (content changed) or
  // settled (stable → main scans the text), and receives per-tab status updates
  // to draw the glyph.
  sendStatusActive: (id: string): void => ipcRenderer.send(STATUS.active, id),
  sendStatusSettled: (id: string, text: string): void => ipcRenderer.send(STATUS.settled, id, text),
  onStatusUpdate: (cb: (e: StatusUpdateEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: StatusUpdateEvent): void => cb(payload)
    ipcRenderer.on(STATUS.update, listener)
    return () => ipcRenderer.off(STATUS.update, listener)
  },
  // S8 subagent panel: one-way pushes from the main-process watchers. Each
  // returns an unsubscribe so the panel can detach on unmount.
  onSubagentSpawn: (cb: (e: SubagentSpawnEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: SubagentSpawnEvent): void => cb(payload)
    ipcRenderer.on(SUBAGENTS.spawn, listener)
    return () => ipcRenderer.off(SUBAGENTS.spawn, listener)
  },
  onSubagentActivity: (cb: (e: SubagentActivityEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: SubagentActivityEvent): void => cb(payload)
    ipcRenderer.on(SUBAGENTS.activity, listener)
    return () => ipcRenderer.off(SUBAGENTS.activity, listener)
  },
  onSubagentDone: (cb: (e: SubagentDoneEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: SubagentDoneEvent): void => cb(payload)
    ipcRenderer.on(SUBAGENTS.done, listener)
    return () => ipcRenderer.off(SUBAGENTS.done, listener)
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
  listSchedules: (): Promise<Schedule[]> => ipcRenderer.invoke(SCHEDULES.list),
  createSchedule: (c: ScheduleCreate): Promise<Schedule> => ipcRenderer.invoke(SCHEDULES.create, c),
  setScheduleEnabled: (id: string, enabled: boolean): Promise<void> =>
    ipcRenderer.invoke(SCHEDULES.setEnabled, id, enabled),
  removeSchedule: (id: string): Promise<void> => ipcRenderer.invoke(SCHEDULES.remove, id),
  onSchedulesChanged: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(SCHEDULES.changed, listener)
    return () => ipcRenderer.off(SCHEDULES.changed, listener)
  },
  onScheduledResume: (cb: (r: ScheduledResume) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: ScheduledResume): void => cb(payload)
    ipcRenderer.on(SCHEDULES.resume, listener)
    return () => ipcRenderer.off(SCHEDULES.resume, listener)
  },
  // The renderer could not open the tab that resume asked for, so the prompt was
  // never delivered; main turns this into the correcting notice.
  scheduleResumeDropped: (payload: ScheduleResumeDropped): void =>
    ipcRenderer.send(SCHEDULES.resumeDropped, payload),
  onStartupSession: (cb: (w: WarmStartup) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: WarmStartup): void => cb(payload)
    ipcRenderer.on(STARTUP.session, listener)
    return () => ipcRenderer.off(STARTUP.session, listener)
  },
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(APP.info),
  getUpdateStatus: (): Promise<UpdateInfo> => ipcRenderer.invoke(UPDATE.get),
  checkForUpdate: (): Promise<UpdateInfo> => ipcRenderer.invoke(UPDATE.check),
  installUpdate: (): void => ipcRenderer.send(UPDATE.install),
  onUpdateStatus: (cb: (e: UpdateInfo) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: UpdateInfo): void => cb(payload)
    ipcRenderer.on(UPDATE.status, listener)
    return () => ipcRenderer.off(UPDATE.status, listener)
  },
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
