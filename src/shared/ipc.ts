import type { Ticket } from './types'

export type GetTicketResult = { ok: true; ticket: Ticket } | { ok: false; error: string }

export const IPC = { getTicket: 'jira:getTicket' } as const

export interface SpawnTerminalRequest {
  id: string
  tool?: string
  ticketKey?: string
  cwdOverride?: string
  cols: number
  rows: number
  prompt?: { name?: string; text?: string }
  resume?: { sessionId: string }
}
export interface TerminalDataEvent { id: string; data: string }
export interface TerminalExitEvent { id: string; exitCode: number }
export type SpawnResult = { ok: true } | { ok: false; error: string }

export const TERM = {
  spawn: 'pty:spawn',
  write: 'pty:write',
  resize: 'pty:resize',
  kill: 'pty:kill',
  data: 'pty:data',
  exit: 'pty:exit'
} as const

export interface PromptSummary { name: string; description: string }
export const PROMPTS = { list: 'prompts:list' } as const

export const SHELL = { openExternal: 'shell:openExternal' } as const

export interface StartupSession {
  mode: 'interactive' | 'yolo'
  promptName?: string
  promptText?: string
  tool?: string
}
export interface DeepLink { action: 'open' | 'yolo'; ticket: string }
// `ready` is the renderer's listener-attached signal: main queues warm links
// until it arrives, so nothing is pushed at a window that can't hear it yet.
export const DEEPLINK = { event: 'deeplink:event', ready: 'deeplink:ready' } as const
export interface StartupOptions {
  tickets: string[]
  session?: StartupSession
  warnings?: string[]
  deeplink?: DeepLink
  // `--orchestrate <TICKET>`: run the Jira Orchestrator on this ticket with NO
  // confirm gate (CLI-only, not web-reachable — used by SeniorDevWatch).
  orchestrate?: string
  minimized?: boolean
}
export const STARTUP = { get: 'startup:get' } as const

export interface StartYoloRequest {
  id: string
  tool?: string
  ticketKey?: string
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

export interface OrchestratorPromptInfo { text: string; isDefault: boolean }
export interface ClassifyRequest { id: string; ticketKey: string; tool?: string }
export type ClassifyResult = { ok: true; prompt: string } | { ok: false; reason: string }
export const ORCHESTRATOR = {
  classify: 'orchestrator:classify', kill: 'orchestrator:kill',
  readPrompt: 'orchestrator:readPrompt', savePrompt: 'orchestrator:savePrompt',
  // Warm-launch signal: a second `--orchestrate` invocation forwards to the
  // running app, which pushes this (no confirm gate) to open an orchestrator tab.
  run: 'orchestrator:run'
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
  read: 'prompts:read', write: 'prompts:write', create: 'prompts:create', delete: 'prompts:delete',
  readContext: 'prompts:readContext', writeContext: 'prompts:writeContext'
} as const
