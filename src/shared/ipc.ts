// The configured repo a ticket's project maps to, or null when nothing maps —
// the composer uses it to prefill the Folder from a detected ticket key.
export type RepoResolution = { key: string; path: string; tool: string } | null

export const IPC = { resolveRepo: 'repos:resolve' } as const

export interface SpawnTerminalRequest {
  id: string
  // S3: the tab's stable conversationId (a crypto.randomUUID). For claude it is
  // pre-assigned as the CLI's --session-id at spawn; for every tool it keys the
  // persisted conversation record. Absent for a pre-S3 / test caller.
  conversationId?: string
  // The tab title, persisted onto the conversation record so the S4 sidebar shows
  // the same label the tab did. Absent for a pre-S3 / test caller.
  title?: string
  tool?: string
  ticketKey?: string
  // The raw composer input (ticket key or free-text description) — fills the
  // {{request}} placeholder so a role prompt works for both ticket and free-text.
  input?: string
  cwdOverride?: string
  cols: number
  rows: number
  prompt?: { name?: string; text?: string }
  resume?: { sessionId: string }
  // S5 worktree isolation. When the composer's "run in a new worktree" toggle is
  // on, the worktree is created pre-flight (worktree:create) and its path arrives
  // here as cwdOverride too; worktreePath/branch are recorded on the conversation.
  // worktreeDefault carries the Task-mode checkbox state (present only for a
  // Task-mode agent launch) so the project can remember the last choice; absent
  // for every other launch, so those never clobber the remembered default.
  worktreePath?: string
  branch?: string
  worktreeDefault?: boolean
}
export interface TerminalDataEvent { id: string; data: string }
export interface TerminalExitEvent { id: string; exitCode: number }
export type SpawnResult = { ok: true } | { ok: false; error: string }

// Terminal mode: a raw shell (pwsh/cmd/bash/wsl) in a chosen folder, no seeded
// prompt — so none of the prompt-delivery machinery runs for it.
export interface SpawnShellRequest {
  id: string
  shell: string
  cwd: string
  cols: number
  rows: number
}
export interface ShellsInfo { shells: string[]; default: string }
export const SHELLS = { list: 'shells:list' } as const

export const TERM = {
  spawn: 'pty:spawn',
  spawnShell: 'pty:spawnShell',
  write: 'pty:write',
  resize: 'pty:resize',
  kill: 'pty:kill',
  data: 'pty:data',
  exit: 'pty:exit'
} as const

export interface PromptSummary { name: string; description: string }
export const PROMPTS = { list: 'prompts:list' } as const

export const SHELL = { openExternal: 'shell:openExternal' } as const

// Composer folder support: the configured repos (for a quick-pick + ticket-prefix
// prefill) and a native directory picker. RepoInfo is the serializable subset the
// renderer needs (label = key, value = path).
export interface RepoInfo { key: string; path: string }
export const REPOS = { list: 'repos:list' } as const
export const DIALOG = { pickFolder: 'dialog:pickFolder' } as const
// Recent folders: an MRU list the app writes on every launch, surfaced as
// quick-pick chips in the composer (distinct from the config-driven repos).
export const RECENT = { list: 'recent:list', record: 'recent:record' } as const
// Text-only clipboard bridge for the terminal (readText/writeText — never image),
// which is what stops Codex erroring "can't paste image" on a paste.
export const CLIPBOARD = { readText: 'clipboard:readText', writeText: 'clipboard:writeText' } as const
// Agent CLI tools offered in the New-tab menu (claude, codex, …) — the default
// tool plus any others whose command resolves on PATH. Returns tool names.
export const TOOLS = { list: 'tools:list' } as const

// Resolved workspace-layout settings the renderer needs (S2). Read-only scalars
// derived from config; the renderer re-fetches on CONFIG.changed.
// `save` (S3): the renderer pushes its current pane/tab layout; main persists it
// (debounced) into workspace.json. Tabs are conversationIds so the layout survives
// a restart even though the ptyIds do not.
// `getSidebar` (S4): the renderer reads the persisted sidebar width/collapsed on
// mount to restore it (window bounds are restored main-side; the sidebar geometry
// travels through the layout, so the renderer needs a read for it).
export const WORKSPACE = { getSettings: 'workspace:getSettings', save: 'workspace:save', getSidebar: 'workspace:getSidebar' } as const
export interface WorkspaceSettings { minPaneWidth: number }
export interface SidebarState { width: number | null; collapsed: boolean }
export interface WorkspacePaneSnapshot {
  id: string
  widthFraction: number
  tabs: string[] // conversationIds
  activeTabId: string | null // conversationId of the active tab
}
export interface WorkspaceLayout {
  panes: WorkspacePaneSnapshot[]
  sidebarWidth: number | null
  sidebarCollapsed: boolean
}

// S4 Projects sidebar. Read-only wire shapes for the persisted stores (the
// renderer must not import from main/store, which pulls in electron/fs) — these
// mirror `Project` / `Conversation` structurally, so a handler can return the
// store objects directly. `SIDEBAR.changed` is a one-way main→renderer nudge: a
// spawn created/updated a project or conversation, codex discovery filled an
// agentSessionId, or the archive job / a restore moved a project — re-fetch. Live
// tab open/close is renderer-reactive (usePanes) and needs no event.
export interface ProjectInfo {
  id: string
  title: string
  path: string
  defaultTool: string
  worktreeDefault: boolean
  lastActiveAt: number
  archivedAt: number | null
  createdAt: number
  updatedAt: number
}
export interface ConversationInfo {
  id: string
  projectId: string
  title: string
  tool: string
  // The stored resume id. null ⇒ never captured (codex where nothing ran, or
  // discovery missed).
  agentSessionId: string | null
  // Whether a resume would actually work, computed fresh at list time: the agent
  // must have PERSISTED a resumable transcript for agentSessionId. A non-null
  // agentSessionId is not enough — claude pre-assigns the id at spawn but only
  // writes the transcript once a session has content, so an empty session has an
  // id but nothing to resume. The sidebar drives its inert/resumable state off
  // THIS, never off agentSessionId alone, so it never offers a resume that fails.
  resumable: boolean
  cwd: string
  worktreePath: string | null
  branch: string | null
  lastActiveAt: number
  createdAt: number
  archivedAt: number | null
}
export const PROJECTS = { list: 'projects:list', setArchived: 'projects:setArchived', ensure: 'projects:ensure' } as const
export const CONVERSATIONS = { list: 'conversations:list', setArchived: 'conversations:setArchived' } as const
export const SIDEBAR = { changed: 'sidebar:changed' } as const

// S5 Worktree toggle (spec section 9). `info` answers the composer's live checkbox
// state for a folder (is it a git repo, the repo's branchPrefix, the project's
// remembered worktreeDefault); it is resolved live via `git -C` and cached ~60s
// (spec 4.3 — nothing about git identity is stored). `create` is the pre-flight
// worktree add the composer awaits before it morphs, so a collision refuses in the
// composer rather than spawning the agent in the wrong cwd. `teardown` archives a
// conversation and, only when opted in, removes its worktree (never a dirty one).
export interface WorktreeInfo {
  isRepo: boolean
  branchPrefix: string
  worktreeDefault: boolean
}
export interface WorktreeCreateRequest {
  folder: string
  branch: string
}
export type WorktreeCreateResult =
  | { ok: true; worktreePath: string; branch: string }
  | { ok: false; error: string }
export interface WorktreeTeardownRequest {
  conversationId: string
  removeWorktree: boolean
}
// The conversation is always archived (reversible, data kept per spec 4.6). The
// worktree result is present only when removal was requested and a worktree exists;
// a removal failure (a dirty tree) is reported here, never silently swallowed.
export interface WorktreeTeardownResult {
  archived: boolean
  worktree?: { ok: boolean; error?: string }
}
export const WORKTREE = { info: 'worktree:info', create: 'worktree:create', teardown: 'worktree:teardown' } as const

export interface StartupSession {
  mode: 'interactive' | 'yolo'
  promptName?: string
  promptText?: string
  tool?: string
}
// A deep link prefills a composer. `ticket` is the anchor; `role` and `folder`
// are optional prefill hints. Nothing launches from a link (see SECURITY.md).
export interface DeepLink { action: 'open' | 'yolo'; ticket: string; role?: string; folder?: string }
// `ready` is the renderer's listener-attached signal: main queues warm links
// until it arrives, so nothing is pushed at a window that can't hear it yet.
export const DEEPLINK = { event: 'deeplink:event', ready: 'deeplink:ready' } as const
export interface StartupOptions {
  tickets: string[]
  session?: StartupSession
  warnings?: string[]
  deeplink?: DeepLink
}
export const STARTUP = { get: 'startup:get' } as const

export interface StartYoloRequest {
  id: string
  tool?: string
  ticketKey?: string
  input?: string
  cwdOverride?: string
  prompt?: { name?: string; text?: string }
}
export interface YoloLogEvent { id: string; text: string }
export interface YoloPrEvent { id: string; url: string; term: string }
export interface YoloExitEvent {
  id: string; exitCode: number; sessionId?: string
  cwd: string; tool: string; canResume: boolean; prUrls: string[]
}
export interface YoloCaps { available: boolean }
export const YOLO = {
  start: 'yolo:start', log: 'yolo:log', pr: 'yolo:pr',
  exit: 'yolo:exit', kill: 'yolo:kill', caps: 'yolo:caps'
} as const

// S1 status system. The five per-tab glyph states (spec 5.1). This is the wire
// type shared between the main-process state machine (terminal/status.ts) and
// the renderer that draws the glyph; the machine LOGIC stays in main.
export type TabStatus = 'working' | 'idle' | 'needsYou' | 'needsReview' | 'failed'

// Idle detection is renderer-side, by RENDERED-BUFFER stability rather than pty
// byte silence: the interactive TUIs repaint (cursor blink) every ~600ms, so the
// byte stream never goes quiet, but xterm collapses those repaints into a buffer
// whose text is stable. The renderer polls its own buffer and reports `active`
// when the text changes and `settled` (with the text) when it has been stable a
// beat. Main matches the settled text against the tool's approvalPatterns and
// pushes the resulting `update` back for the glyph.
export interface StatusActiveEvent { id: string }
export interface StatusSettledEvent { id: string; text: string }
export interface StatusUpdateEvent { id: string; status: TabStatus }
export const STATUS = {
  active: 'status:active', // renderer → main (buffer text changed → working)
  settled: 'status:settled', // renderer → main (buffer text stable → scan for a prompt)
  update: 'status:update' // main → renderer (the resolved glyph state)
} as const

export type MenuAction =
  | 'new-session'
  | 'app-config'
  | 'prompt-config'
  | 'about'
  | 'move-tab-left'
  | 'move-tab-right'
export const MENU = { action: 'menu:action' } as const

export interface AppInfo { name: string; version: string }
export const APP = { info: 'app:info' } as const

export type ConfigReadResult = { ok: true; text: string; path: string; isTemplate?: boolean } | { ok: false; error: string }
export type SaveResult = { ok: true } | { ok: false; error: string }
export interface RecapInfo { text: string; isDefault: boolean }
export interface PreambleInfo { text: string; isDefault: boolean }
export const CONFIG = {
  read: 'config:read', save: 'config:save', changed: 'config:changed',
  readRecap: 'config:readRecap', saveRecap: 'config:saveRecap',
  readPreamble: 'config:readPreamble', savePreamble: 'config:savePreamble'
} as const

export type PromptReadResult = { ok: true; text: string } | { ok: false; error: string }
export const PROMPT_FILES = {
  read: 'prompts:read', write: 'prompts:write', create: 'prompts:create', delete: 'prompts:delete'
} as const
