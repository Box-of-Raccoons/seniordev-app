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
export interface StartupOptions {
  tickets: string[]
  session?: StartupSession
  warnings?: string[]
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
