import { createJsonStore, type JsonStore, type VersionedDoc } from './json-store'
import { workspacePath } from './paths'
import type { WorkspacePaneSnapshot, WorkspaceLayout, SubagentPanelState } from '../../shared/ipc'
import { SUBAGENT_PANEL_DEFAULTS } from '../../shared/ipc'

export type { WorkspacePaneSnapshot, WorkspaceLayout }

// The hot store (spec section 4.1): rewritten on every tab move / pane resize, so
// it lives apart from the cold projects.json and warm conversations.json. Holds
// the window geometry and the pane/tab layout. Tabs are stored as conversationIds
// (stable across restarts), not ptyIds (ephemeral). Per decision D2, S3 restores
// the window bounds only; re-materialising tabs from this layout is S4's job.
export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
}

export interface WorkspaceDoc extends VersionedDoc {
  version: 1
  windowBounds: WindowBounds | null
  sidebarWidth: number | null
  sidebarCollapsed: boolean
  panes: WorkspacePaneSnapshot[]
  // S7: when true, archiving a conversation with no worktree skips the confirm
  // dialog ("Don't ask again"). Worktree teardowns always still confirm.
  suppressTeardownConfirm: boolean
  // S8: the subagent panel's persisted geometry (placement/collapsed/size/appOnly).
  subagentPanel: SubagentPanelState
}

// Validate a persisted subagent-panel blob, falling back per-field to the
// defaults so a partial or pre-S8 doc is always coerced to a complete state.
function migrateSubagentPanel(raw: unknown): SubagentPanelState {
  const o = (raw ?? {}) as Partial<SubagentPanelState>
  return {
    placement: o.placement === 'bottom' ? 'bottom' : 'right',
    collapsed: o.collapsed === true,
    size: typeof o.size === 'number' && o.size > 0 ? o.size : SUBAGENT_PANEL_DEFAULTS.size,
    appOnly: o.appOnly === true
  }
}

function isBounds(v: unknown): v is WindowBounds {
  const b = v as Partial<WindowBounds> | null
  return !!b && typeof b.width === 'number' && typeof b.height === 'number'
}

function migrateWorkspace(raw: unknown): WorkspaceDoc {
  const o = (raw ?? {}) as Partial<WorkspaceDoc>
  const panes = Array.isArray(o.panes)
    ? o.panes
        .filter((p): p is WorkspacePaneSnapshot => !!p && typeof (p as WorkspacePaneSnapshot).id === 'string')
        .map((p) => ({
          id: p.id,
          widthFraction: typeof p.widthFraction === 'number' ? p.widthFraction : 1,
          tabs: Array.isArray(p.tabs) ? p.tabs.filter((t): t is string => typeof t === 'string') : [],
          activeTabId: typeof p.activeTabId === 'string' ? p.activeTabId : null
        }))
    : []
  return {
    version: 1,
    windowBounds: isBounds(o.windowBounds) ? o.windowBounds : null,
    sidebarWidth: typeof o.sidebarWidth === 'number' ? o.sidebarWidth : null,
    sidebarCollapsed: o.sidebarCollapsed === true,
    panes,
    suppressTeardownConfirm: o.suppressTeardownConfirm === true,
    subagentPanel: migrateSubagentPanel(o.subagentPanel)
  }
}

export interface WorkspaceStore {
  get(): WorkspaceDoc
  getWindowBounds(): WindowBounds | null
  setWindowBounds(bounds: WindowBounds): void
  setLayout(layout: WorkspaceLayout): void
  setSuppressTeardownConfirm(v: boolean): void
  flush(): void
}

export function createWorkspaceStore(deps?: { file?: string }): WorkspaceStore {
  const store: JsonStore<WorkspaceDoc> = createJsonStore({
    file: deps?.file ?? workspacePath(),
    migrate: migrateWorkspace
  })
  return {
    get: () => store.get(),
    getWindowBounds: () => store.get().windowBounds,
    setWindowBounds(bounds) {
      store.mutate((d) => {
        d.windowBounds = bounds
      })
    },
    setLayout(layout) {
      store.mutate((d) => {
        d.panes = layout.panes
        d.sidebarWidth = layout.sidebarWidth
        d.sidebarCollapsed = layout.sidebarCollapsed
        if (layout.subagentPanel) d.subagentPanel = layout.subagentPanel
      })
    },
    setSuppressTeardownConfirm(v) {
      store.mutate((d) => {
        d.suppressTeardownConfirm = v
      })
    },
    flush: () => store.flush()
  }
}
