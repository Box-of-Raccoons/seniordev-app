// The configured repo a ticket's project maps to, or null when nothing maps —
// the composer uses it to prefill the Folder from a detected ticket key.
export type RepoResolution = { key: string; path: string; tool: string } | null

export const IPC = { resolveRepo: 'repos:resolve' } as const

export interface SpawnTerminalRequest {
  id: string
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
// Agent CLI tools offered in the New-tab menu (claude, codex, …) — the default
// tool plus any others whose command resolves on PATH. Returns tool names.
export const TOOLS = { list: 'tools:list' } as const

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

export type MenuAction = 'new-session' | 'app-config' | 'prompt-config' | 'about'
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
