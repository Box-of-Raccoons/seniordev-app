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
export const WORKSPACE = { getSettings: 'workspace:getSettings' } as const
export interface WorkspaceSettings { minPaneWidth: number }

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
