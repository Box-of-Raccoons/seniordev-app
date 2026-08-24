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
  // An explicit per-launch model, which WINS over the prompt's declared model.
  // The schedule's choice is the most specific and was authored deliberately.
  model?: string
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
// `models` returns the model ids suggested per tool where a launch can choose
// one (the schedules form), keyed by tool name. Suggestions only: a model absent
// from the list is still accepted, so an id newer than the config stays usable.
export const TOOLS = { list: 'tools:list', models: 'tools:models' } as const

// Resolved workspace-layout settings the renderer needs (S2). Read-only scalars
// derived from config; the renderer re-fetches on CONFIG.changed.
// `save` (S3): the renderer pushes its current pane/tab layout; main persists it
// (debounced) into workspace.json. Tabs are conversationIds so the layout survives
// a restart even though the ptyIds do not.
// `getSidebar` (S4): the renderer reads the persisted sidebar width/collapsed on
// mount to restore it (window bounds are restored main-side; the sidebar geometry
// travels through the layout, so the renderer needs a read for it).
export const WORKSPACE = {
  getSettings: 'workspace:getSettings',
  save: 'workspace:save',
  getSidebar: 'workspace:getSidebar',
  setSuppressTeardownConfirm: 'workspace:setSuppressTeardownConfirm'
} as const
export interface WorkspaceSettings { minPaneWidth: number }
// S7: `suppressTeardownConfirm` — skip the archive confirm for no-worktree teardowns.
// Boot-time UI chrome state read once on mount: the sidebar geometry, the
// teardown-confirm preference, and (S8) the subagent panel's persisted geometry.
export interface SidebarState {
  width: number | null
  collapsed: boolean
  suppressTeardownConfirm: boolean
  // Optional so an older workspace.json (pre-S8) and test mocks still satisfy the
  // shape; the renderer falls back to SUBAGENT_PANEL_DEFAULTS when absent.
  subagentPanel?: SubagentPanelState
}
export interface WorkspacePaneSnapshot {
  id: string
  widthFraction: number
  tabs: string[] // conversationIds
  activeTabId: string | null // conversationId of the active tab
}
// The subagent panel's persisted geometry (S8). `placement` picks which slot it
// mounts in (a right rail, sibling of the sidebar; or a bottom strip under the
// panes). `size` is the width in px when placement is 'right', the height in px
// when 'bottom'.
export type SubagentPanelPlacement = 'right' | 'bottom'
export interface SubagentPanelState {
  placement: SubagentPanelPlacement
  collapsed: boolean
  size: number
  appOnly: boolean
}
export const SUBAGENT_PANEL_DEFAULTS: SubagentPanelState = {
  placement: 'right',
  collapsed: false,
  size: 300,
  appOnly: false
}

export interface WorkspaceLayout {
  panes: WorkspacePaneSnapshot[]
  sidebarWidth: number | null
  sidebarCollapsed: boolean
  subagentPanel?: SubagentPanelState
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

// Supervision epic, slice 1: read-only review of what sessions actually changed.
// Both calls are `git diff` under the hood; nothing here stages or commits.
export const REVIEW = { list: 'review:list', diff: 'review:diff' } as const

export interface ReviewEntryInfo {
  path: string
  insertions: number
  deletions: number
  binary: boolean
  // Untracked files have no HEAD side; their counts are whole-file.
  untracked: boolean
}

export interface ReviewSessionInfo {
  conversationId: string
  title: string
  tool: string
}

// One working tree with pending changes. Keyed by tree, not by session, because
// uncommitted work belongs to a folder: two tabs on one folder share this diff.
export interface ReviewTreeInfo {
  cwd: string
  branch: string | null
  sessions: ReviewSessionInfo[]
  files: number
  insertions: number
  deletions: number
  entries: ReviewEntryInfo[]
  // How many untracked files were dropped past the scan cap; 0 when complete.
  untrackedTruncated: number
  // Set when git could not answer at all (folder deleted, not a repo). The UI
  // shows this instead of an empty review that would read as "nothing changed".
  error: string | null
}

export interface ReviewDiffInfo {
  // Parsed unified diff; shape mirrors shared/diff-parse DiffFile.
  files: {
    path: string
    oldPath: string | null
    status: 'added' | 'deleted' | 'modified' | 'renamed'
    binary: boolean
    insertions: number
    deletions: number
    hunks: { header: string; lines: { kind: 'add' | 'del' | 'context'; text: string; oldLine: number | null; newLine: number | null }[] }[]
  }[]
  error: string | null
}

export interface StartupSession {
  mode: 'interactive' | 'yolo'
  promptName?: string
  promptText?: string
  tool?: string
  // An explicit model for this launch, overriding what the prompt or the tool
  // would otherwise resolve to. Absent ⇒ unchanged behaviour (prompt frontmatter,
  // then the tool's defaultModel, then nothing). Only meaningful for a launch: a
  // resume reconnects to an existing session and drops model args by design.
  model?: string
  // Working directory for the session (--folder). Becomes the tab's cwdOverride,
  // so the agent spawns here instead of the home-dir fallback — which matters
  // because an agent CLI shows a "trust this folder?" gate in an untrusted dir,
  // and that gate would swallow the injected prompt. Point it at a trusted repo.
  folder?: string
}
// A deep link prefills a composer. `ticket` is the anchor; `role` and `folder`
// are optional prefill hints. Nothing launches from a link (see SECURITY.md).
export interface DeepLink { action: 'open' | 'yolo'; ticket: string; role?: string; folder?: string }
// `ready` is the renderer's listener-attached signal: main queues warm links
// until it arrives, so nothing is pushed at a window that can't hear it yet.
export const DEEPLINK = { event: 'deeplink:event', ready: 'deeplink:ready' } as const

// Scheduled prompts. A schedule is a launch the developer deferred: it delivers
// its prompt into an existing conversation, or starts a fresh session, at a time
// they chose. Two of the three delivery paths need a TAB, which only the renderer
// can create — a `launch` schedule reuses STARTUP.session wholesale, and `resume`
// below is the one push this feature adds, reopening a stored conversation with
// its prompt seeded. Both ride the same DEEPLINK.ready gate as deep links.
// A schedule is a launch the developer deferred. The record crosses the bridge
// whole (the modal shows every field), so it lives here rather than in the main
// store, the same split as Conversation / ConversationInfo.
//
// A `conversation` target holds a conversationId, never a tab id: tab ids are
// per-launch, and a schedule has to survive the tab being closed and the app
// being restarted between authoring and firing. A `launch` target holds a
// StartupSession, the shape the app already auto-starts a session from, rather
// than a second parallel launch format.
export type ScheduleTarget =
  | { kind: 'conversation'; conversationId: string }
  | { kind: 'launch'; session: StartupSession; ticket?: string }

// Deliberately not cron: three shapes cover the real cases with no parser, no
// parse-error surface, and no UI that has to explain `0 5 * * *`. `daily` stores
// LOCAL hour/minute so 5am stays 5am across a DST shift; `notBeforeMs` on `every`
// is an earliest-start ("every 30 minutes, but not before 5am"), not a fire-at.
export type ScheduleTrigger =
  | { kind: 'once'; atMs: number }
  | { kind: 'every'; intervalMs: number; notBeforeMs: number | null }
  | { kind: 'daily'; hour: number; minute: number }

// How a firing resolved. `deferred` is the only one that does not advance the
// schedule: the target was busy, so the same slot is retried on the next tick.
export type ScheduleOutcome = 'fired' | 'deferred' | 'skipped' | 'missed' | 'failed'

export interface Schedule {
  id: string
  enabled: boolean
  title: string
  target: ScheduleTarget
  prompt: string
  trigger: ScheduleTrigger
  // A slot that passed while the app was closed: run it once late, or record the
  // miss and move on to the next one.
  catchUp: boolean
  // Never null for a recurring trigger. An uncapped recurring schedule pointed at
  // a YOLO launch is an unbounded burn, and a confirm at creation time does not
  // bound it — the record does.
  maxFirings: number | null
  stopOnFailure: boolean
  firedCount: number
  nextDueAt: number
  lastFiredAt: number | null
  lastOutcome: ScheduleOutcome | null
  lastReason: string | null
  deferredSinceAt: number | null
  createdAt: number
}

export interface ScheduleCreate {
  title?: string
  target: ScheduleTarget
  prompt: string
  trigger: ScheduleTrigger
  catchUp?: boolean
  maxFirings?: number | null
  stopOnFailure?: boolean
}

export interface ScheduledResume {
  conversationId: string
  prompt: string
  // The schedule this push came from. Carried so a resume the renderer cannot
  // complete can name itself in the correction notice below.
  scheduleId: string
  title: string
}
// The renderer could not open the tab a scheduled resume asked for, so the
// prompt was never delivered. Main has already recorded the firing, so this is
// the correction the user sees.
export interface ScheduleResumeDropped {
  title: string
  reason: string
}
export const SCHEDULES = {
  list: 'schedules:list',
  create: 'schedules:create',
  setEnabled: 'schedules:setEnabled',
  remove: 'schedules:remove',
  changed: 'schedules:changed', // main → renderer: the list moved, re-read it
  resume: 'schedules:resume', // main → renderer: reopen this conversation and seed it
  resumeDropped: 'schedules:resumeDropped' // renderer → main: that resume never landed
} as const
export interface StartupOptions {
  tickets: string[]
  session?: StartupSession
  warnings?: string[]
  deeplink?: DeepLink
}
// A warm session start: a second `seniordev --prompt|--yolo|--tool …` launch
// arriving at the already-running instance (via second-instance). Unlike a deep
// link — which only prefills a composer — a CLI session auto-starts, matching
// cold-start behavior; the local command line is a trusted surface (see
// resolve-launch.ts). `ticket` is the first positional key, if any.
export interface WarmStartup { session: StartupSession; ticket?: string }
// `get` (pull) hands cold-start options to the renderer; `session` (push) carries
// a warm CLI session to the live renderer, gated on the shared DEEPLINK.ready.
export const STARTUP = { get: 'startup:get', session: 'startup:session' } as const

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

// Live subagent-activity panel (watchers ported from racconsole). Main tails the
// CLI transcript trees and PUSHES these one-way to the renderer; there is no
// renderer→main call. The shapes are shared so the watchers (main) and the panel
// (renderer) agree. `session` is the parent Claude session id; `agent` the
// per-worker subagent id. For codex there are no subagents, so session === agent.
export type SubagentActivityKind = 'tool' | 'text' | 'thinking'
export interface SubagentSpawnEvent {
  session: string
  agent: string
  agentType?: string
  description?: string
  ts: number
}
export interface SubagentActivityEvent {
  session: string
  agent: string
  kind: SubagentActivityKind
  tool?: string
  target?: string
  text?: string
  ts: number
}
export interface SubagentDoneEvent {
  session: string
  agent: string
  ts: number
}
export const SUBAGENTS = {
  spawn: 'subagents:spawn', // main → renderer
  activity: 'subagents:activity', // main → renderer
  done: 'subagents:done' // main → renderer
} as const

export type MenuAction =
  | 'new-session'
  | 'review'
  | 'schedules'
  | 'app-config'
  | 'prompt-config'
  | 'about'
  | 'move-tab-left'
  | 'move-tab-right'
export const MENU = { action: 'menu:action' } as const

export interface AppInfo { name: string; version: string }
export const APP = { info: 'app:info' } as const

// Auto-update (electron-updater over the GitHub Releases feed). The app downloads
// in the background and installs on quit; `install` is the explicit "restart now"
// path, which the renderer only offers after warning about live sessions.
export type UpdateState = 'idle' | 'checking' | 'downloading' | 'ready' | 'error'
export interface UpdateStatus {
  state: UpdateState
  version?: string
  percent?: number
  message?: string
}
// `supported` is false in an unpackaged build (pnpm dev), where there is no
// updater at all — the UI hides the affordance rather than showing a dead button.
export interface UpdateInfo extends UpdateStatus { supported: boolean }
export const UPDATE = {
  get: 'update:get', // renderer → main (current status, e.g. on modal open)
  check: 'update:check', // renderer → main (manual check)
  install: 'update:install', // renderer → main (quit and install now)
  status: 'update:status' // main → renderer (every status transition)
} as const

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
