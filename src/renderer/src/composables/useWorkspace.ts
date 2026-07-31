import { reactive, ref, type Ref } from 'vue'
import { usePanes, type UsePanes } from './usePanes'
import type { TabStatus, SubagentPanelState } from '../../../shared/ipc'
import { SUBAGENT_PANEL_DEFAULTS } from '../../../shared/ipc'

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
  // True while a Projects-sidebar row is being dragged. Cross-component (the
  // Sidebar sets it; RightPanel reads it) so the pane drop targets — the edge
  // shoulders and the per-pane overlay — light up for a conversation drag, not
  // only a tab drag (which RightPanel already tracks with its own local flag).
  // Not persisted; transient drag state.
  draggingConversation: Ref<boolean>
  // S8 subagent panel geometry (placement/collapsed/size/appOnly), persisted in
  // workspace.json alongside the sidebar geometry and restored on boot by App.
  // A reactive object so the panel can mutate fields in place and the RightPanel
  // save watcher picks them up.
  subagentPanel: SubagentPanelState
}

export function useWorkspace(): UseWorkspace {
  return {
    panes: usePanes(),
    statuses: reactive<Record<string, TabStatus>>({}),
    sidebarWidth: ref<number | null>(null),
    sidebarCollapsed: ref(false),
    draggingConversation: ref(false),
    subagentPanel: reactive<SubagentPanelState>({ ...SUBAGENT_PANEL_DEFAULTS })
  }
}
