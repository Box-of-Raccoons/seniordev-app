import { computed, reactive, ref, type ComputedRef } from 'vue'

// The runtime tab model (spec section 6.1). `ptyId` is the id passed to every
// terminal IPC call and is the S1 status key — kept identical to the old flat
// `Term.id` scheme so neither IPC nor status wiring changes. `conversationId` is
// minted now but nothing reads it until S3 (spec section 3 ordering constraint).
export type TabKind = 'composer' | 'terminal' | 'yolo' | 'shell'

export interface LiveTab {
  ptyId: string
  conversationId: string
  title: string
  kind: TabKind
  tool?: string
  variant?: 'agent' | 'terminal'
  prefill?: { input?: string; folder?: string; role?: string }
  // S6: when a composer is launched from a project, the folder is fixed to the
  // project. Its presence locks/hides the folder field and shows the name as a
  // header; the folder itself rides in prefill.folder.
  lockedProject?: string
  prompt?: { name?: string; text?: string }
  // An explicit model for this launch (a scheduled launch that named one).
  // Absent ⇒ the prompt's or the tool's model resolves as before.
  model?: string
  input?: string
  ticketKey?: string
  shell?: string
  resume?: { sessionId: string }
  cwdOverride?: string
  // S5: when the launch ran in a git worktree, its path (also the cwdOverride) and
  // branch, recorded on the conversation via the spawn. worktreeChoice is the
  // Task-mode checkbox state, threaded to the spawn so the project remembers it.
  worktreePath?: string
  branch?: string
  worktreeChoice?: boolean
  exited?: boolean
}

// A column. `widthFraction` (not pixels) so proportions survive a window resize
// (spec section 6.1). Fractions across all panes always sum to 1.
export interface Pane {
  id: string
  widthFraction: number
  tabs: LiveTab[]
  activeTabId: string | null
}

// conversationId is normally minted per tab, but a resume-from-sidebar (S4) must
// carry the ORIGINAL conversation's id so the spawn upserts the same record
// instead of forking a duplicate sidebar row. Optional: every existing caller
// omits it and still gets a fresh id.
export type NewTab = Omit<LiveTab, 'ptyId' | 'conversationId'> & { conversationId?: string }

export interface UsePanes {
  panes: Pane[]
  focusedPaneId: ComputedRef<string | null>
  leftmostPaneId: ComputedRef<string>
  allTabs: ComputedRef<{ tab: LiveTab; paneId: string }[]>
  hasTabs: ComputedRef<boolean>
  addTab: (partial: NewTab, toPaneId?: string) => LiveTab
  closeTab: (ptyId: string) => void
  focusTab: (paneId: string, ptyId: string) => void
  setFocusedPane: (paneId: string) => void
  moveTab: (ptyId: string, toPaneId: string, toIndex?: number) => void
  moveToNewPane: (ptyId: string, side: 'left' | 'right') => void
  // Create an empty column at the left or right edge and return its id, WITHOUT
  // moving an existing tab into it (unlike moveToNewPane). Used when a sidebar
  // conversation is dropped on a shoulder: make the split, then focus/resume the
  // conversation into the new pane. Panes are re-equalized.
  addEdgePane: (side: 'left' | 'right') => string
  moveActiveToAdjacentPane: (dir: -1 | 1) => void
  resizePane: (leftPaneId: string, deltaFraction: number, minFraction: number) => void
  markExited: (ptyId: string) => void
  find: (ptyId: string) => { tab: LiveTab; pane: Pane } | null
  // Locate a live tab by its conversationId, across every pane (S4: click a
  // conversation with a live tab → focus it wherever it lives). At most one live
  // tab holds a given conversationId, so the first match is the answer.
  findByConversationId: (conversationId: string) => { ptyId: string; paneId: string } | null
  // The same lookup restricted to a tab whose process is still running. A tab
  // stays on screen after its agent exits, and an exited tab is not a session a
  // scheduled prompt can be delivered into.
  findLiveByConversationId: (conversationId: string) => { ptyId: string; paneId: string } | null
  isActiveInFocusedPane: (ptyId: string) => boolean
}

let paneCounter = 0
let tabCounter = 0

function newPaneId(): string {
  paneCounter += 1
  return `p${paneCounter}-${Date.now()}`
}

// Keep the exact old id scheme (RightPanel used `t${counter}-${Date.now()}`), so
// the value that flows to spawnTerminal/spawnShell/startYolo and the status map
// key is unchanged from S1.
function newPtyId(): string {
  tabCounter += 1
  return `t${tabCounter}-${Date.now()}`
}

function newConversationId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  // Fallback for environments without crypto.randomUUID; unique enough for a
  // runtime id that is not yet persisted.
  tabCounter += 1
  return `c${tabCounter}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
}

// Spread the total width evenly across every pane. Called whenever the pane count
// changes (add / remove) so columns always start balanced (spec section 6.2:
// "Split sizing distributes space equally across all panes.").
function equalize(panes: Pane[]): void {
  const n = panes.length
  if (n === 0) return
  const each = 1 / n
  for (const p of panes) p.widthFraction = each
}

export function usePanes(): UsePanes {
  // Seed with a single empty pane so there is always a slot to render into.
  const panes = reactive<Pane[]>([{ id: newPaneId(), widthFraction: 1, tabs: [], activeTabId: null }])
  const focusedPaneIdRef = ref<string>(panes[0].id)

  const focusedPaneId = computed(() =>
    panes.some((p) => p.id === focusedPaneIdRef.value) ? focusedPaneIdRef.value : (panes[0]?.id ?? null)
  )

  // The leftmost column. S4 resumes a conversation into the leftmost pane rather
  // than the focused one, because focus is invisible state and "it opened where I
  // was not looking" is a real failure mode. There is always at least one pane.
  const leftmostPaneId = computed(() => panes[0].id)

  // Flat list of every tab with its owning pane id, for the single teleport
  // `v-for` in RightPanel. Order follows pane order then in-pane order.
  const allTabs = computed(() => panes.flatMap((p) => p.tabs.map((tab) => ({ tab, paneId: p.id }))))
  const hasTabs = computed(() => panes.some((p) => p.tabs.length > 0))

  function paneOf(ptyId: string): Pane | undefined {
    return panes.find((p) => p.tabs.some((t) => t.ptyId === ptyId))
  }

  function find(ptyId: string): { tab: LiveTab; pane: Pane } | null {
    const pane = paneOf(ptyId)
    const tab = pane?.tabs.find((t) => t.ptyId === ptyId)
    return pane && tab ? { tab, pane } : null
  }

  function targetPane(toPaneId?: string): Pane {
    return panes.find((p) => p.id === toPaneId) ?? panes.find((p) => p.id === focusedPaneId.value) ?? panes[0]
  }

  function addTab(partial: NewTab, toPaneId?: string): LiveTab {
    // Spread first, then set the ids last so a provided (resume) conversationId is
    // honoured and a `conversationId: undefined` in partial can never clobber a
    // freshly minted one.
    const tab: LiveTab = { ...partial, ptyId: newPtyId(), conversationId: partial.conversationId ?? newConversationId() }
    const pane = targetPane(toPaneId)
    pane.tabs.push(tab)
    pane.activeTabId = tab.ptyId
    focusedPaneIdRef.value = pane.id
    return tab
  }

  // Remove a pane and hand its width back to the remaining panes. The last pane
  // is never removed (it holds the empty state), only emptied.
  function removePaneIfEmpty(pane: Pane): void {
    if (pane.tabs.length > 0 || panes.length === 1) return
    const i = panes.findIndex((p) => p.id === pane.id)
    if (i === -1) return
    panes.splice(i, 1)
    equalize(panes)
    if (focusedPaneIdRef.value === pane.id) focusedPaneIdRef.value = panes[Math.max(0, i - 1)].id
  }

  function closeTab(ptyId: string): void {
    const pane = paneOf(ptyId)
    if (!pane) return
    const i = pane.tabs.findIndex((t) => t.ptyId === ptyId)
    if (i === -1) return
    pane.tabs.splice(i, 1)
    if (pane.activeTabId === ptyId) pane.activeTabId = pane.tabs.at(-1)?.ptyId ?? null
    removePaneIfEmpty(pane)
  }

  function focusTab(paneId: string, ptyId: string): void {
    const pane = panes.find((p) => p.id === paneId)
    if (!pane || !pane.tabs.some((t) => t.ptyId === ptyId)) return
    pane.activeTabId = ptyId
    focusedPaneIdRef.value = paneId
  }

  function setFocusedPane(paneId: string): void {
    if (panes.some((p) => p.id === paneId)) focusedPaneIdRef.value = paneId
  }

  function moveTab(ptyId: string, toPaneId: string, toIndex?: number): void {
    const from = paneOf(ptyId)
    const to = panes.find((p) => p.id === toPaneId)
    if (!from || !to) return
    const i = from.tabs.findIndex((t) => t.ptyId === ptyId)
    if (i === -1) return
    const [tab] = from.tabs.splice(i, 1)
    // Clamp the insertion index; when moving within the same pane the removal
    // above has already shifted later indices, which is the intended behavior.
    const at = toIndex === undefined ? to.tabs.length : Math.max(0, Math.min(toIndex, to.tabs.length))
    to.tabs.splice(at, 0, tab)
    to.activeTabId = ptyId
    focusedPaneIdRef.value = to.id
    if (from.id !== to.id) {
      if (from.activeTabId === ptyId) from.activeTabId = from.tabs.at(-1)?.ptyId ?? null
      removePaneIfEmpty(from)
    }
  }

  // Create a new column at the left or right edge and move the tab into it.
  // Backs both drag-to-edge and the keyboard edge-move. If the tab's source pane
  // would empty out, it is removed by moveTab's cleanup — so dragging the only
  // tab of a single pane to the edge is a no-op reshape rather than a duplicate.
  function moveToNewPane(ptyId: string, side: 'left' | 'right'): void {
    const from = paneOf(ptyId)
    if (!from) return
    // A lone tab in the only pane has nowhere new to go.
    if (panes.length === 1 && from.tabs.length === 1) return
    const pane: Pane = { id: newPaneId(), widthFraction: 0, tabs: [], activeTabId: null }
    if (side === 'left') panes.unshift(pane)
    else panes.push(pane)
    equalize(panes)
    moveTab(ptyId, pane.id)
  }

  function addEdgePane(side: 'left' | 'right'): string {
    const pane: Pane = { id: newPaneId(), widthFraction: 0, tabs: [], activeTabId: null }
    if (side === 'left') panes.unshift(pane)
    else panes.push(pane)
    equalize(panes)
    return pane.id
  }

  function moveActiveToAdjacentPane(dir: -1 | 1): void {
    const pane = panes.find((p) => p.id === focusedPaneId.value)
    const active = pane?.activeTabId
    if (!pane || !active) return
    const idx = panes.findIndex((p) => p.id === pane.id)
    const targetIdx = idx + dir
    if (targetIdx < 0 || targetIdx >= panes.length) {
      // Past the edge → spill into a brand-new edge pane.
      moveToNewPane(active, dir < 0 ? 'left' : 'right')
      return
    }
    moveTab(active, panes[targetIdx].id)
  }

  // Shift width between a pane and its right neighbor. Works purely in fraction
  // space (DOM-free): the caller converts minPaneWidth px / container px into a
  // minFraction. Both neighbors are clamped to >= minFraction so neither collapses.
  function resizePane(leftPaneId: string, deltaFraction: number, minFraction: number): void {
    const i = panes.findIndex((p) => p.id === leftPaneId)
    if (i === -1 || i + 1 >= panes.length) return
    const left = panes[i]
    const right = panes[i + 1]
    const total = left.widthFraction + right.widthFraction
    // Keep both sides within [minFraction, total - minFraction]; if the pair is
    // too narrow to honor the minimum, leave it split evenly and bail.
    if (total < minFraction * 2) {
      left.widthFraction = right.widthFraction = total / 2
      return
    }
    let next = left.widthFraction + deltaFraction
    next = Math.max(minFraction, Math.min(next, total - minFraction))
    left.widthFraction = next
    right.widthFraction = total - next
  }

  function markExited(ptyId: string): void {
    const tab = find(ptyId)?.tab
    if (tab) tab.exited = true
  }

  function isActiveInFocusedPane(ptyId: string): boolean {
    const pane = panes.find((p) => p.id === focusedPaneId.value)
    return !!pane && pane.activeTabId === ptyId
  }

  function findByConversationId(conversationId: string): { ptyId: string; paneId: string } | null {
    for (const pane of panes) {
      const tab = pane.tabs.find((t) => t.conversationId === conversationId)
      if (tab) return { ptyId: tab.ptyId, paneId: pane.id }
    }
    return null
  }

  function findLiveByConversationId(conversationId: string): { ptyId: string; paneId: string } | null {
    for (const pane of panes) {
      const tab = pane.tabs.find((t) => t.conversationId === conversationId && !t.exited)
      if (tab) return { ptyId: tab.ptyId, paneId: pane.id }
    }
    return null
  }

  return {
    panes,
    focusedPaneId,
    leftmostPaneId,
    allTabs,
    hasTabs,
    addTab,
    closeTab,
    focusTab,
    setFocusedPane,
    moveTab,
    moveToNewPane,
    addEdgePane,
    moveActiveToAdjacentPane,
    resizePane,
    markExited,
    find,
    findByConversationId,
    findLiveByConversationId,
    isActiveInFocusedPane
  }
}
