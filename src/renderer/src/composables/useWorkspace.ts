import { reactive, ref, type Ref } from 'vue'
import { usePanes, type UsePanes } from './usePanes'
import type { TabStatus } from '../../../shared/ipc'

// The shared workspace-layout state (S4 / decision A3). Lifted out of RightPanel
// so the Projects sidebar and the pane area — siblings under App — read one source
// of truth for the tab/pane model and per-tab status.
//
// Deliberately a PLAIN factory: no Vue lifecycle hooks (onMounted / watch), so it
// can be instantiated in a unit test without mounting a component. App owns the
// lifecycle wiring (restore the sidebar geometry on boot), and RightPanel drives
// the rest (the STATUS.update listener that fills `statuses`, and the debounced
// workspace:save watcher). Only the shared STATE lives here; the behaviour stays
// with the components that already own it, which keeps this a low-churn lift.
export interface UseWorkspace {
  panes: UsePanes
  // Per-tab S1 status keyed by ptyId (the id the main process reports on
  // STATUS.update). Shared so the sidebar can draw a conversation's glyph from the
  // same map the tab strip uses, via panes.findByConversationId → ptyId.
  statuses: Record<string, TabStatus>
  // Sidebar geometry, persisted in workspace.json. null width ⇒ the sidebar uses
  // its default until the user resizes. Restored on boot by App.
  sidebarWidth: Ref<number | null>
  sidebarCollapsed: Ref<boolean>
}

export function useWorkspace(): UseWorkspace {
  return {
    panes: usePanes(),
    statuses: reactive<Record<string, TabStatus>>({}),
    sidebarWidth: ref<number | null>(null),
    sidebarCollapsed: ref(false)
  }
}
