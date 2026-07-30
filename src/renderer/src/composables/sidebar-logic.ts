import type { ProjectInfo, ConversationInfo } from '../../../shared/ipc'
import type { NewTab } from './usePanes'

// Pure, DOM-free logic for the S4 Projects sidebar (spec section 8). Kept out of
// the component so the sort, the 5/10/all cap, and the per-row open/resumable
// derivation are unit-testable; the component is then just the view over these.

// Active projects, most-recently-active first (spec: "sorted by lastActiveAt
// descending"). A stable tiebreak on id keeps equal timestamps from reordering
// between refreshes.
export function activeProjectsByRecency(projects: ProjectInfo[]): ProjectInfo[] {
  return projects
    .filter((p) => p.archivedAt === null)
    .slice()
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// Archived projects for the collapsed `Archived (n)` section, most-recently
// archived first.
export function archivedProjects(projects: ProjectInfo[]): ProjectInfo[] {
  return projects
    .filter((p) => p.archivedAt !== null)
    .slice()
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// A project's live (non-archived) conversations, most-recently-active first.
// S5 archives a conversation on teardown, and this archivedAt filter is what drops
// it from the list — the S4 groundwork now has a consumer.
export function conversationsForProject(conversations: ConversationInfo[], projectId: string): ConversationInfo[] {
  return conversations
    .filter((c) => c.projectId === projectId && c.archivedAt === null)
    .slice()
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// Whether a conversation's teardown should offer to remove a worktree (S5): only
// when it actually ran in one. The archive itself is always offered; the worktree
// checkbox appears only for a conversation that has a worktreePath.
export function teardownOffersWorktree(conv: Pick<ConversationInfo, 'worktreePath'>): boolean {
  return !!conv.worktreePath
}

// A project's ARCHIVED conversations for the "Archived (n)" reveal (S6 restore),
// most-recently-archived first.
export function archivedConversationsForProject(
  conversations: ConversationInfo[],
  projectId: string
): ConversationInfo[] {
  return conversations
    .filter((c) => c.projectId === projectId && c.archivedAt !== null)
    .slice()
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// S6 launch specs: a project's + menu launches directly into the project, so the
// folder is always the project path. Pure NewTab builders (DOM-free, unit-tested);
// the sidebar hands these to ws.panes.addTab(spec, leftmostPaneId).

// AI (Task): a folder-locked composer, so tool/role/prompt/YOLO/worktree are still
// chosen, but the folder is fixed to the project (lockedProject drives the lock).
export function composerTabSpec(project: Pick<ProjectInfo, 'title' | 'path' | 'defaultTool'>): NewTab {
  return {
    title: `session · ${project.title}`,
    kind: 'composer',
    variant: 'agent',
    initialMode: 'task',
    tool: project.defaultTool,
    lockedProject: project.title,
    prefill: { folder: project.path }
  }
}

// Open: a bare agent (no role/prompt), spawned immediately in the project with its
// default tool. kind 'terminal' = an interactive agent; no prompt => bare.
export function openSessionTabSpec(project: Pick<ProjectInfo, 'title' | 'path' | 'defaultTool'>): NewTab {
  return {
    title: `${project.title} · ${project.defaultTool}`,
    kind: 'terminal',
    variant: 'agent',
    tool: project.defaultTool,
    cwdOverride: project.path
  }
}

// Terminal: a raw shell, spawned immediately in the project.
export function terminalTabSpec(project: Pick<ProjectInfo, 'title' | 'path'>, shell: string): NewTab {
  return {
    title: `${shell} · ${project.title}`,
    kind: 'shell',
    shell,
    cwdOverride: project.path
  }
}

// The disclosure cap (spec: 5, then "show more" → 10, then "show all" →
// everything). `level` is the current expansion; the returned `next` is the level
// the "show more"/"show all" control advances to, or null when everything shows.
export type CapLevel = 'collapsed' | 'more' | 'all'
const CAP_LIMIT: Record<CapLevel, number> = { collapsed: 5, more: 10, all: Infinity }

export function capConversations<T>(list: T[], level: CapLevel): { visible: T[]; next: CapLevel | null } {
  const visible = list.slice(0, CAP_LIMIT[level])
  // More remain only when the current limit clipped the list; the control then
  // steps collapsed→more→all. (A list of 8 at 'more' shows all 8 → no control.)
  const next: CapLevel | null = list.length > visible.length ? (level === 'collapsed' ? 'more' : 'all') : null
  return { visible, next }
}

// One conversation row's derived state. `live` is the result of looking the
// conversation's id up in the pane model (null ⇒ no live tab). Open-state and
// resumability are separate signals: an open row focuses its tab; a closed but
// resumable one spawns a resume; a closed non-resumable one (agentSessionId null)
// is inert (spec section 8).
export interface RowState {
  open: boolean
  ptyId: string | null
  paneId: string | null
  resumable: boolean
}

export function rowState(
  conversation: Pick<ConversationInfo, 'resumable'>,
  live: { ptyId: string; paneId: string } | null
): RowState {
  return {
    open: live !== null,
    ptyId: live?.ptyId ?? null,
    paneId: live?.paneId ?? null,
    // `resumable` is computed main-side (does the agent have a real transcript),
    // not inferred from agentSessionId — an empty session has an id but no
    // resumable transcript. See ConversationInfo.resumable / session-resumable.ts.
    resumable: conversation.resumable
  }
}

// A sidebar row can be dragged into a specific pane (spec section 8, reusing S2's
// native DnD). It carries a distinct dataTransfer type so a pane can tell a
// conversation drop from a tab-reorder drop, plus the minimal data a resume needs
// (RightPanel holds no conversations list of its own).
export const CONVERSATION_DND_TYPE = 'application/x-sd-conversation'

export interface ConversationDragPayload {
  id: string
  title: string
  tool: string
  cwd: string
  agentSessionId: string | null
}

export function conversationDragPayload(conv: ConversationInfo): ConversationDragPayload {
  return { id: conv.id, title: conv.title, tool: conv.tool, cwd: conv.cwd, agentSessionId: conv.agentSessionId }
}

// The addTab partial that resumes a conversation into a chosen pane: reuse the
// record id (so the spawn upserts the same conversation, never a duplicate row)
// and drive the tool's resumeArgs via `resume`. Requires a real agentSessionId.
export function resumeTabSpec(conv: { id: string; title: string; tool: string; cwd: string; agentSessionId: string }): NewTab {
  return {
    title: conv.title || 'session',
    kind: 'terminal',
    variant: 'agent',
    tool: conv.tool,
    conversationId: conv.id,
    resume: { sessionId: conv.agentSessionId },
    cwdOverride: conv.cwd
  }
}

// What a conversation dropped onto a pane should do: focus/move an already-live
// tab, resume a dead-but-resumable one, or nothing for a non-resumable one.
export type ConversationDropAction = { action: 'move'; ptyId: string } | { action: 'resume' } | { action: 'none' }

export function conversationDropAction(
  payload: Pick<ConversationDragPayload, 'agentSessionId'>,
  live: { ptyId: string } | null
): ConversationDropAction {
  if (live) return { action: 'move', ptyId: live.ptyId }
  if (payload.agentSessionId) return { action: 'resume' }
  return { action: 'none' }
}
