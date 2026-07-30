import { createJsonStore, type JsonStore, type VersionedDoc } from './json-store'
import { workspacePath } from './paths'
import type { WorkspacePaneSnapshot, WorkspaceLayout } from '../../shared/ipc'

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
    panes
  }
}

export interface WorkspaceStore {
  get(): WorkspaceDoc
  getWindowBounds(): WindowBounds | null
  setWindowBounds(bounds: WindowBounds): void
  setLayout(layout: WorkspaceLayout): void
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
      })
    },
    flush: () => store.flush()
  }
}
