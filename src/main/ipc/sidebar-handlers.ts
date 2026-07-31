import { ipcMain } from 'electron'
import { PROJECTS, CONVERSATIONS, WORKSPACE, SIDEBAR, type SidebarState, type ConversationInfo } from '../../shared/ipc'
import type { SessionPersistence } from '../session-persistence'
import type { WorkspaceStore } from '../store/workspace-store'
import type { Project } from '../store/projects-store'
import type { ConfigSource } from '../config/store'
import { isConversationResumable } from '../session-resumable'

// S4: read-only surface over the S3 stores that backs the Projects sidebar, plus
// the one mutating action the sidebar owns (restore an archived project). The
// stores are already instantiated in index.ts; here they are exposed to the
// renderer. `Project`/`Conversation` satisfy the `ProjectInfo`/`ConversationInfo`
// wire shapes structurally, so they cross the bridge unchanged.
export function registerSidebarIpc(deps: {
  persistence: SessionPersistence
  workspace: WorkspaceStore
  getSender: () => Electron.WebContents | undefined
  // Config source, for the default tool a New Project (S6) is created with.
  source?: ConfigSource
  // Whether a conversation can actually be resumed (its agent persisted a real
  // transcript). Injectable for tests; defaults to the on-disk check.
  isResumable?: (conv: { tool: string; agentSessionId: string | null }) => boolean
}): void {
  const isResumable = deps.isResumable ?? ((c): boolean => isConversationResumable(c))
  ipcMain.handle(PROJECTS.list, (): Project[] => deps.persistence.projects.list())
  // Enrich each stored conversation with a freshly computed `resumable` flag; the
  // sidebar drives its inert/resumable state off this, never off agentSessionId
  // alone, so it never offers a resume that would fail (empty claude session).
  ipcMain.handle(CONVERSATIONS.list, (): ConversationInfo[] =>
    deps.persistence.conversations.list().map((c) => ({ ...c, resumable: isResumable(c) }))
  )

  // Restore (archived=false) or archive (archived=true) a project, then nudge the
  // sidebar to repartition. Restore is the sidebar's own control; auto-archiving
  // happens elsewhere (the daily job) and nudges through persistence.onChange.
  ipcMain.handle(PROJECTS.setArchived, (_e, id: string, archived: boolean): void => {
    deps.persistence.projects.setArchived(id, archived)
    deps.getSender()?.send(SIDEBAR.changed)
  })

  // S6: explicitly create (or refresh) a project from a picked folder — the "New
  // Project" flow — without launching anything. ensureForCwd is idempotent, so a
  // folder that already has a project just bumps its recency. Returns the row so
  // the sidebar can open its launch menu immediately.
  ipcMain.handle(PROJECTS.ensure, (_e, folder: string): Project => {
    const defaultTool = deps.source?.config?.defaultTool ?? 'claude'
    const project = deps.persistence.projects.ensureForCwd(folder, { defaultTool })
    deps.getSender()?.send(SIDEBAR.changed)
    return project
  })

  // S6: restore an archived conversation (archived=false) — the teardown-restore
  // gap. Archiving happens via worktree:teardown; this is the reverse.
  ipcMain.handle(CONVERSATIONS.setArchived, (_e, id: string, archived: boolean): void => {
    deps.persistence.conversations.setArchived(id, archived)
    deps.getSender()?.send(SIDEBAR.changed)
  })

  // Restore the persisted sidebar geometry on mount. Window bounds are restored
  // main-side in createWindow; the sidebar width/collapsed live in the same store
  // but are applied by the renderer, so it reads them here.
  ipcMain.handle(WORKSPACE.getSidebar, (): SidebarState => {
    const d = deps.workspace.get()
    return {
      width: d.sidebarWidth,
      collapsed: d.sidebarCollapsed,
      suppressTeardownConfirm: d.suppressTeardownConfirm,
      subagentPanel: d.subagentPanel
    }
  })

  // S7: persist the "Don't ask again" teardown preference.
  ipcMain.handle(WORKSPACE.setSuppressTeardownConfirm, (_e, v: boolean): void => {
    deps.workspace.setSuppressTeardownConfirm(v)
  })
}
