<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import TerminalView from './TerminalView.vue'
import YoloView from './YoloView.vue'
import Composer from './Composer.vue'
import EmptyState from './EmptyState.vue'
import StatusGlyph from './StatusGlyph.vue'
import SubagentPanel from './SubagentPanel.vue'
import raccoonAsleepUrl from '../assets/raccoon-asleep.png'
import { shouldNotify, notificationText } from '../status-notify'
import { type LiveTab } from '../composables/usePanes'
import type { UseWorkspace } from '../composables/useWorkspace'
import type { UseSubagents } from '../composables/useSubagents'
import type { UseScheduleBadges } from '../composables/useScheduleBadges'
import { describeNextRun } from '../schedule-format'
import type { ConversationInfo, ScheduledResume } from '../../../shared/ipc'
import { shouldAutoClose } from '../auto-close'
import {
  CONVERSATION_DND_TYPE,
  resumeTabSpec,
  conversationDropAction,
  type ConversationDragPayload
} from '../composables/sidebar-logic'
import type { ComposerLaunch } from './composer-types'
import type { TabStatus, WorkspaceLayout } from '../../../shared/ipc'

interface Prefill {
  input?: string
  folder?: string
  role?: string
}

// S4 / A3: the tab+pane model and per-tab status are lifted into the shared
// `ws` (useWorkspace) so the Projects sidebar — a sibling under App — reads the
// same source of truth. RightPanel still OWNS the behaviour over that state: the
// status/notification glue, the workspace-save watcher, and the layout view.
const props = defineProps<{ ws: UseWorkspace; subagents: UseSubagents; scheduleBadges?: UseScheduleBadges }>()

// A live tab says when something is queued to type into it. Same reasoning as the
// sidebar row: unattended machine work is visible on the thing it will act on.
// The tab strip is tight, so the word lives in the title and aria-label rather
// than inline, but it is never conveyed by colour alone.
function tabScheduleNote(conversationId: string): string | null {
  const s = props.scheduleBadges?.soonestFor(conversationId)
  if (!s) return null
  return `Scheduled: ${s.title}, next ${describeNextRun(s, props.scheduleBadges?.now.value ?? Date.now())}`
}
const panes = props.ws.panes

// S8: when the subagent panel is docked at the bottom, it mounts here as a flex
// child below the panes row. Height mirrors the persisted size (a slim bar when
// collapsed). The right-rail placement mounts in App instead.
const SUBAGENT_COLLAPSED_PX = 34
const subagentBottomStyle = computed(() => ({
  flex: `0 0 ${props.ws.subagentPanel.collapsed ? SUBAGENT_COLLAPSED_PX : props.ws.subagentPanel.size}px`
}))
const { allTabs, hasTabs } = panes

// Teleport targets by pane id. Each pane registers its .pane-slot element here
// via a function ref; a tab's content teleports into `slotEls[paneId]`. Using the
// element (not a CSS selector) means teleport resolves without a document query,
// so it works detached (tests) and multi-pane alike. Until a pane's slot exists,
// the tab's teleport is disabled and its content renders inline — harmless, since
// v-show keeps a non-active tab hidden.
const slotEls = reactive<Record<string, HTMLElement>>({})
function setSlot(paneId: string, el: Element | null): void {
  if (el) slotEls[paneId] = el as HTMLElement
  else delete slotEls[paneId]
}

// The pane row, used to convert a pixel drag into a width fraction and to derive
// minPaneWidth as a fraction of the current row width.
const panesRow = ref<HTMLElement | null>(null)

// minPaneWidth (px) comes from config; re-fetched on config change so a live edit
// takes effect without a restart. Defaults to 320 until the first fetch resolves.
const minPaneWidth = ref(320)
let offConfig: (() => void) | null = null
async function loadSettings(): Promise<void> {
  try {
    const s = await window.api.getWorkspaceSettings()
    if (s?.minPaneWidth) minPaneWidth.value = s.minPaneWidth
  } catch {
    // Keep the default; a missing setting must never break layout.
  }
}
onMounted(() => {
  void loadSettings()
  offConfig = window.api.onConfigChanged(() => void loadSettings())
})
onBeforeUnmount(() => offConfig?.())

// Convert minPaneWidth (px) to a fraction of the current pane-row width.
function minFraction(): number {
  const width = panesRow.value?.clientWidth ?? 0
  return width > 0 ? minPaneWidth.value / width : 0.1
}

// Keyboard resize (WCAG operability): an arrow key on a focused splitter nudges
// the boundary by a fixed fraction, honouring the same minimum as the drag.
function onSplitterKey(e: KeyboardEvent, leftPaneId: string): void {
  const step = 0.03
  if (e.key === 'ArrowLeft') panes.resizePane(leftPaneId, -step, minFraction())
  else if (e.key === 'ArrowRight') panes.resizePane(leftPaneId, step, minFraction())
  else return
  e.preventDefault()
}

// Splitter drag: shift width between a pane and its right neighbor. Deltas are
// incremental (per pointermove) and converted px→fraction against the live row
// width, so the pane's xterm ResizeObserver re-fits and pushes pty:resize as the
// flex basis changes. minPaneWidth is passed through as a fraction so neither
// side collapses below the configured minimum.
let dragLeftPaneId: string | null = null
let dragLastX = 0
function onSplitterDown(e: PointerEvent, leftPaneId: string): void {
  dragLeftPaneId = leftPaneId
  dragLastX = e.clientX
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  e.preventDefault()
}
function onSplitterMove(e: PointerEvent): void {
  if (!dragLeftPaneId || !panesRow.value) return
  const width = panesRow.value.clientWidth
  if (width <= 0) return
  const delta = (e.clientX - dragLastX) / width
  dragLastX = e.clientX
  panes.resizePane(dragLeftPaneId, delta, minPaneWidth.value / width)
}
function onSplitterUp(e: PointerEvent): void {
  dragLeftPaneId = null
  try {
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
  } catch {
    // Pointer capture may already be gone; ignore.
  }
}

// Tab drag-and-drop (native HTML5 DnD, no dependency). The dragged tab keeps its
// ptyId, so moveTab only re-parents it in the model — the teleport target changes
// and the live terminal relocates without unmounting (spec 6.3). draggingPtyId
// also gates the edge drop zones so they only appear mid-drag.
const draggingPtyId = ref<string | null>(null)
function onTabDragStart(e: DragEvent, ptyId: string): void {
  draggingPtyId.value = ptyId
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', ptyId)
  }
}
function onTabDragEnd(): void {
  draggingPtyId.value = null
}
function dragId(e: DragEvent): string | null {
  return draggingPtyId.value ?? (e.dataTransfer?.getData('text/plain') || null)
}
// A sidebar row drop (S4): distinguished from a tab-reorder drop by its custom
// dataTransfer type. Returns the parsed payload, or null for a tab drag / bad data.
function convDrag(e: DragEvent): ConversationDragPayload | null {
  const raw = e.dataTransfer?.getData(CONVERSATION_DND_TYPE)
  if (!raw) return null
  try {
    return JSON.parse(raw) as ConversationDragPayload
  } catch {
    return null
  }
}
// Land a dropped conversation in this pane: focus/relocate an already-live tab,
// resume a dead-but-resumable one HERE (the dropped-on pane, not the leftmost —
// the drag names the target), or ignore a non-resumable one.
function dropConversation(payload: ConversationDragPayload, paneId: string): void {
  const live = panes.findByConversationId(payload.id)
  const act = conversationDropAction(payload, live)
  if (act.action === 'move') panes.moveTab(act.ptyId, paneId)
  else if (act.action === 'resume' && payload.agentSessionId) {
    panes.addTab(resumeTabSpec({ ...payload, agentSessionId: payload.agentSessionId }), paneId)
  }
}
// Drop onto a specific tab: insert the dragged tab at that tab's position.
function onDropOnTab(e: DragEvent, paneId: string, beforePtyId: string): void {
  const conv = convDrag(e)
  if (conv) {
    draggingPtyId.value = null
    dropConversation(conv, paneId)
    return
  }
  const id = dragId(e)
  draggingPtyId.value = null
  if (!id || id === beforePtyId) return
  const pane = panes.panes.find((p) => p.id === paneId)
  const idx = pane?.tabs.findIndex((t) => t.ptyId === beforePtyId)
  panes.moveTab(id, paneId, idx)
}
// Drop onto empty strip space: append to that pane.
function onDropOnStrip(e: DragEvent, paneId: string): void {
  const conv = convDrag(e)
  if (conv) {
    draggingPtyId.value = null
    dropConversation(conv, paneId)
    return
  }
  const id = dragId(e)
  draggingPtyId.value = null
  if (id) panes.moveTab(id, paneId)
}
// A drag is in flight if it's a tab reorder (our local flag) OR a sidebar
// conversation drag (shared flag the Sidebar sets). Gates the edge shoulders and
// the per-pane drop overlay so they only appear mid-drag.
const dragActive = computed(() => !!draggingPtyId.value || props.ws.draggingConversation.value)
function clearDrag(): void {
  draggingPtyId.value = null
  props.ws.draggingConversation.value = false
}

// Drop onto a window edge: spin off a new column there. A conversation drop makes
// the new column, then focuses/relocates a live tab or resumes a dead one into it;
// a tab drop moves the existing tab into a fresh edge pane.
function onDropEdge(e: DragEvent, side: 'left' | 'right'): void {
  const conv = convDrag(e)
  if (conv) {
    const paneId = panes.addEdgePane(side)
    dropConversation(conv, paneId)
    clearDrag()
    return
  }
  const id = dragId(e)
  clearDrag()
  if (id) panes.moveToNewPane(id, side)
}

// Drop onto a pane's body overlay (not just its tab strip): route a conversation
// into that pane, or move a dragged tab into it. The overlay sits above xterm only
// during a drag, so the terminal's own drop handling is never fought at rest.
function onDropInPane(e: DragEvent, paneId: string): void {
  const conv = convDrag(e)
  if (conv) {
    clearDrag()
    dropConversation(conv, paneId)
    return
  }
  const id = dragId(e)
  clearDrag()
  if (id) panes.moveTab(id, paneId)
}

// Live per-tab status (S1), keyed by ptyId — which is the id the main process
// reports on STATUS.update. A tab with no entry (composer, or nothing running
// yet) shows no glyph. Independent of pane layout, so a dragged tab keeps its
// glyph: the lookup is by ptyId, which a moved tab retains (spec section 3).
// Shared through `ws` (A3) so the sidebar draws the same glyphs; RightPanel is the
// writer (the STATUS.update listener below), the sidebar a reader.
const statuses = props.ws.statuses
let offStatus: (() => void) | null = null
onMounted(() => {
  offStatus = window.api.onStatusUpdate((e) => {
    const prev = statuses[e.id]
    statuses[e.id] = e.status
    maybeNotify(prev, e.id, e.status)
  })
})
onBeforeUnmount(() => offStatus?.())

// Fire an OS notification on a transition into needsYou / needsReview, unless the
// user is already looking at that tab — active in the focused pane, window
// focused (spec 5.5). Predicate is pure (status-notify).
function maybeNotify(prev: TabStatus | undefined, id: string, next: TabStatus): void {
  const looking = panes.isActiveInFocusedPane(id)
  if (!shouldNotify(prev, next, looking, document.hasFocus())) return
  const term = panes.find(id)?.tab
  const { heading, body } = notificationText(next as 'needsYou' | 'needsReview', term?.title ?? 'Session')
  try {
    new Notification(heading, { body })
  } catch {
    // Notifications unavailable (denied / unsupported) — never fatal.
  }
}

// S3: persist the pane/tab layout to workspace.json. Tabs are serialised as
// conversationIds (stable across restarts), not ptyIds (ephemeral). Debounced so
// a resize drag or a burst of tab moves collapses into one push; main debounces
// the disk write again. Per decision D2, this layout is persisted but not
// re-materialised into tabs on boot — that is the S4 sidebar's job.
function serializeLayout(): WorkspaceLayout {
  return {
    panes: panes.panes.map((p) => ({
      id: p.id,
      widthFraction: p.widthFraction,
      tabs: p.tabs.map((t) => t.conversationId),
      activeTabId: p.tabs.find((t) => t.ptyId === p.activeTabId)?.conversationId ?? null
    })),
    // S4: the sidebar geometry now travels in the same layout snapshot. Persisted
    // here (RightPanel drives the save); the sidebar mutates ws.sidebarWidth/Collapsed.
    sidebarWidth: props.ws.sidebarWidth.value,
    sidebarCollapsed: props.ws.sidebarCollapsed.value,
    // S8: the subagent panel geometry travels in the same snapshot.
    subagentPanel: { ...props.ws.subagentPanel }
  }
}
let saveTimer: ReturnType<typeof setTimeout> | null = null
watch(
  [() => panes.panes, props.ws.sidebarWidth, props.ws.sidebarCollapsed, () => props.ws.subagentPanel],
  () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => window.api.saveWorkspace(serializeLayout()), 400)
  },
  { deep: true }
)
onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer)
})

// Programmatic new tab (boot / reset / deep-link): a default agent composer on
// the default CLI tool. Used by the native "New Session" menu (App) as a fallback;
// the primary launch path is now the Projects sidebar (S6), which opens sessions
// scoped to a project via ws.panes.addTab directly.
function newTab(): void {
  panes.addTab({ title: 'New session', kind: 'composer', variant: 'agent' })
}

// Open a prefilled agent composer (used by the deep-link entry point). The user
// reviews the prefill and launches it themselves.
function openComposer(prefill: Prefill): void {
  panes.addTab({ title: 'New session', kind: 'composer', variant: 'agent', prefill })
}

function basename(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
}
function short(s: string, n = 22): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

// Morph a composer tab in place into the session it launched. Mutating the tab
// flips the slot's v-if, so Composer unmounts and the run view mounts + spawns.
// The tab keeps its ptyId, so its teleport entry is stable across the morph.
function launch(t: LiveTab, p: ComposerLaunch): void {
  // S5: when a worktree was created pre-flight, the agent must spawn in the WORKTREE
  // dir, not the project folder — so the worktree path becomes the cwdOverride that
  // flows through the spawn to node-pty. Record the branch/choice for the spawn too.
  t.cwdOverride = p.worktreePath ?? p.folder
  t.worktreePath = p.worktreePath
  t.branch = p.branch
  t.worktreeChoice = p.worktreeChoice
  // Remember the folder we actually launched into (best-effort; see recent-folders).
  window.api.recordRecentFolder(p.folder)
  if (p.mode === 'terminal') {
    t.kind = 'shell'
    t.shell = p.shell
    t.title = `${p.shell ?? 'shell'} · ${basename(p.folder)}`
    return
  }
  t.kind = p.yolo ? 'yolo' : 'terminal'
  t.tool = p.tool ?? t.tool
  t.prompt = p.role ? { name: p.role } : undefined
  t.input = p.input
  t.ticketKey = p.ticketKey
  const subject = p.ticketKey ?? (p.input ? short(p.input) : basename(p.folder))
  t.title = `${p.role ?? 'session'} · ${subject}`
}

let startupSeq = 0
// A scheduled firing whose conversation has no live tab: reopen it and seed the
// prompt the schedule carries. Main has already confirmed the agent has a real
// transcript to resume (session-resumable), so this only has to find the record
// and build the tab. Main recorded the firing as `fired` before pushing, so every
// path that cannot get there reports back rather than returning quietly: an
// undelivered prompt the schedule claims it ran is the failure to avoid.
async function startScheduledResume(r: ScheduledResume): Promise<void> {
  const dropped = (reason: string): void => window.api.scheduleResumeDropped({ title: r.title, reason })
  // Live-only: an exited tab still on screen holds the conversationId but has no
  // process to type into, and must not block the resume.
  if (panes.findLiveByConversationId(r.conversationId)) {
    dropped('the conversation reopened before the prompt arrived, so it was not delivered')
    return
  }
  let convs: ConversationInfo[]
  try {
    convs = await window.api.listConversations()
  } catch {
    dropped('the conversation list could not be read')
    return
  }
  const conv = convs.find((c) => c.id === r.conversationId)
  if (!conv?.agentSessionId) {
    dropped('the conversation has no session id to resume')
    return
  }
  panes.addTab(resumeTabSpec({ ...conv, agentSessionId: conv.agentSessionId }, r.prompt))
}

function startStartupSession(
  s: { mode: 'interactive' | 'yolo'; promptName?: string; promptText?: string; tool?: string; folder?: string; model?: string },
  ticketKey?: string
): void {
  const prompt = s.promptName ? { name: s.promptName } : s.promptText ? { text: s.promptText } : undefined
  startupSeq += 1
  panes.addTab({
    title: `${s.promptName ?? (s.mode === 'yolo' ? 'yolo' : 'session')} ${startupSeq}`,
    kind: s.mode === 'yolo' ? 'yolo' : 'terminal',
    prompt,
    tool: s.tool,
    // A scheduled launch may name its own model, so a routine job need not burn
    // the default one. Absent leaves prompt/tool resolution exactly as it was.
    model: s.model,
    ticketKey,
    // When a role prompt is named, promptText loses the `prompt` slot above —
    // carry it as the input so it still lands in the role's {{request}}.
    input: ticketKey ?? s.promptText,
    // Spawn in the given folder (a --folder from the CLI); without it the agent
    // falls back to the home dir and hits its "trust this folder?" gate.
    cwdOverride: s.folder
  })
}

function closeAll(): void {
  for (const { tab } of [...allTabs.value]) closeTerm(tab.ptyId)
}

function hasSessions(): boolean {
  return hasTabs.value
}

// Keyboard pane op (from the Panes menu accelerators): move the focused pane's
// active tab to the adjacent pane, spilling into a new edge column past the edge.
function moveActiveTab(dir: -1 | 1): void {
  panes.moveActiveToAdjacentPane(dir)
}

defineExpose({ newTab, openComposer, startStartupSession, startScheduledResume, closeAll, hasSessions, moveActiveTab })

function resumeYolo(from: LiveTab, p: { sessionId: string; cwd: string; tool: string }): void {
  panes.addTab({
    title: `${from.title} (resumed)`,
    kind: 'terminal',
    tool: p.tool || undefined,
    resume: { sessionId: p.sessionId },
    cwdOverride: p.cwd || undefined
  })
}

function closeTerm(id: string): void {
  panes.closeTab(id)
  delete statuses[id]
}

// A tab's pty exited. D3 / spec 7.2: cleanly-exited agent (terminal) or shell tabs
// close automatically (nothing to look at; agent conversations survive in storage
// and stay resumable). Everything else stays — YOLO for review, any failure so it
// is visible — marked dead (line-through) via the existing markExited path.
function onTabExited(tab: LiveTab, code: number): void {
  if (shouldAutoClose(tab.kind, code)) {
    closeTerm(tab.ptyId)
    return
  }
  panes.markExited(tab.ptyId)
}

// A teleported tab is visible only when it is the active tab of its own pane.
function isVisible(paneId: string, ptyId: string): boolean {
  const pane = panes.panes.find((p) => p.id === paneId)
  return !!pane && pane.activeTabId === ptyId
}
</script>

<template>
  <section class="workbench">
    <!-- Columns only (spec 6.2). Each pane owns its tab strip and + menu; a
         draggable splitter sits between adjacent panes. -->
    <div ref="panesRow" class="panes-row">
      <!-- Edge drop zones: only live during a tab drag, so a drop at the window
           edge spins the tab off into a new column (spec 6.2). -->
      <div
        v-show="dragActive"
        class="pane-edge pane-edge--left"
        @dragover.prevent
        @drop="onDropEdge($event, 'left')"
      ></div>
      <div
        v-show="dragActive"
        class="pane-edge pane-edge--right"
        @dragover.prevent
        @drop="onDropEdge($event, 'right')"
      ></div>
      <template v-for="(pane, i) in panes.panes" :key="pane.id">
        <div
          class="pane"
          :class="{ 'pane--focused': pane.id === panes.focusedPaneId.value && panes.panes.length > 1 }"
          :style="{ flexGrow: pane.widthFraction, flexBasis: 0 }"
          @pointerdown="panes.setFocusedPane(pane.id)"
        >
          <div class="term-bar">
            <nav class="term-tabs" @dragover.prevent @drop="onDropOnStrip($event, pane.id)">
              <div
                v-for="tab in pane.tabs"
                :key="tab.ptyId"
                class="term-tab"
                :class="{ 'term-tab--active': tab.ptyId === pane.activeTabId, 'term-tab--dead': tab.exited }"
                draggable="true"
                @dragstart="onTabDragStart($event, tab.ptyId)"
                @dragend="onTabDragEnd"
                @dragover.prevent
                @drop.stop="onDropOnTab($event, pane.id, tab.ptyId)"
              >
                <StatusGlyph class="term-tab__status" :status="statuses[tab.ptyId] ?? null" />
                <button class="term-tab__label" @click="panes.focusTab(pane.id, tab.ptyId)">{{ tab.title }}</button>
                <span
                  v-if="tabScheduleNote(tab.conversationId)"
                  class="term-tab__sched"
                  role="img"
                  :aria-label="tabScheduleNote(tab.conversationId)!"
                  :title="tabScheduleNote(tab.conversationId)!"
                >&#9201;</span>
                <button class="term-tab__close" :aria-label="`Close ${tab.title}`" @click="closeTerm(tab.ptyId)">×</button>
              </div>
            </nav>
          </div>

          <div class="term-body">
            <EmptyState v-if="!pane.tabs.length" :image="raccoonAsleepUrl" caption="No sessions yet. Launch one from a project in the sidebar." />
            <div class="pane-slot" :ref="(el) => setSlot(pane.id, el as Element | null)"></div>
            <!-- Drop overlay: only present mid-drag, so it sits above xterm just long
                 enough to catch a session (or tab) dropped onto the live view, then
                 gets out of the terminal's way. -->
            <div
              v-show="dragActive"
              class="pane-drop"
              @dragover.prevent
              @drop="onDropInPane($event, pane.id)"
            ></div>
          </div>
        </div>
        <div
          v-if="i < panes.panes.length - 1"
          class="pane-splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panes (arrow keys)"
          tabindex="0"
          @pointerdown="onSplitterDown($event, pane.id)"
          @pointermove="onSplitterMove"
          @pointerup="onSplitterUp"
          @keydown="onSplitterKey($event, pane.id)"
        ></div>
      </template>
    </div>

    <SubagentPanel
      v-if="ws.subagentPanel.placement === 'bottom'"
      :subagents="subagents"
      :ws="ws"
      :style="subagentBottomStyle"
    />

    <!-- Flat teleport list: every tab's content is mounted exactly once here and
         teleported into its pane's slot. Moving a tab changes the teleport target,
         not its position in this list, so xterm is never unmounted and scrollback
         survives (spec section 6.3). -->
    <template v-for="entry in allTabs" :key="entry.tab.ptyId">
      <Teleport :to="slotEls[entry.paneId]" :disabled="!slotEls[entry.paneId]">
        <div v-show="isVisible(entry.paneId, entry.tab.ptyId)" class="term-slot">
          <Composer
            v-if="entry.tab.kind === 'composer'"
            :active="panes.isActiveInFocusedPane(entry.tab.ptyId)"
            :variant="entry.tab.variant ?? 'agent'"
            :tool="entry.tab.tool"
            :initial-input="entry.tab.prefill?.input"
            :initial-folder="entry.tab.prefill?.folder"
            :initial-role="entry.tab.prefill?.role"
            :project-name="entry.tab.lockedProject"
            @launch="launch(entry.tab, $event)"
          />
          <YoloView
            v-else-if="entry.tab.kind === 'yolo'"
            :id="entry.tab.ptyId"
            :ticket-key="entry.tab.ticketKey ?? null"
            :input="entry.tab.input"
            :prompt="entry.tab.prompt"
            :model="entry.tab.model"
            :tool="entry.tab.tool"
            @exited="onTabExited(entry.tab, $event)"
            @resume="resumeYolo(entry.tab, $event)"
          />
          <TerminalView
            v-else-if="entry.tab.kind === 'shell'"
            :id="entry.tab.ptyId"
            :active="panes.isActiveInFocusedPane(entry.tab.ptyId)"
            :shell="entry.tab.shell"
            :cwd-override="entry.tab.cwdOverride"
            @exited="onTabExited(entry.tab, $event)"
          />
          <TerminalView
            v-else
            :id="entry.tab.ptyId"
            :active="panes.isActiveInFocusedPane(entry.tab.ptyId)"
            :conversation-id="entry.tab.conversationId"
            :conversation-title="entry.tab.title"
            :ticket-key="entry.tab.ticketKey ?? null"
            :input="entry.tab.input"
            :prompt="entry.tab.prompt"
            :model="entry.tab.model"
            :tool="entry.tab.tool"
            :resume="entry.tab.resume"
            :cwd-override="entry.tab.cwdOverride"
            :worktree-path="entry.tab.worktreePath"
            :branch="entry.tab.branch"
            :worktree-choice="entry.tab.worktreeChoice"
            @exited="onTabExited(entry.tab, $event)"
          />
        </div>
      </Teleport>
    </template>
  </section>
</template>

<style scoped>
.workbench { display: flex; flex-direction: column; height: 100%; flex: 1; min-width: 0; background: var(--surface); }
.panes-row { flex: 1; display: flex; min-height: 0; min-width: 0; position: relative; }
/* Edge drop zones. Transparent, activated only mid-drag; the hairline hint reads
   as "drop here to make a column" without adding chrome at rest. */
.pane-edge {
  position: absolute; top: 0; bottom: 0; width: 28px; z-index: 5;
  background: var(--hairline);
}
.pane-edge--left { left: 0; }
.pane-edge--right { right: 0; }
.pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
/* Which pane keyboard actions target. A tonal hairline step, never colour or a
   stripe (DESIGN.md Tone-First / no side-border-stripe). */
.pane--focused .term-bar { border-bottom-color: var(--hairline-strong); }
/* Draggable column divider. Transparent hit area with a centred hairline; the
   hairline strengthens on hover so the grab target reads without shouting. */
.pane-splitter {
  flex: 0 0 7px; cursor: col-resize; position: relative; align-self: stretch;
  background: transparent; touch-action: none;
}
.pane-splitter::before {
  content: ''; position: absolute; top: 0; bottom: 0; left: 3px; width: 1px;
  background: var(--hairline);
}
.pane-splitter:hover::before { background: var(--hairline-strong); left: 2px; width: 3px; }
.pane-splitter:focus-visible { outline: 2px solid var(--teal); outline-offset: -2px; }
.term-bar { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--hairline); }
.term-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.term-tab {
  display: inline-flex; align-items: center;
  background: var(--surface); color: var(--ink-soft);
  border: 1px solid var(--hairline); border-radius: var(--radius-sm);
}
.term-tab--active { background: var(--surface-2); color: var(--ink); }
.term-tab--dead .term-tab__label { color: var(--ink-muted); text-decoration: line-through; }
.term-tab__status { display: inline-flex; align-items: center; padding-left: 9px; }
.term-tab__sched { color: var(--teal); font-size: 11px; flex: 0 0 auto; }
.term-tab__label {
  background: transparent; border: 0; color: inherit; font: inherit;
  padding: 5px 4px 5px 8px; cursor: pointer;
}
.term-tab__close {
  background: transparent; border: 0; color: var(--ink-muted); font: inherit; line-height: 1;
  padding: 5px 8px; cursor: pointer;
}
.term-tab__close:hover { color: var(--ink); }
.term-tab__label:focus-visible, .term-tab__close:focus-visible {
  outline: 2px solid var(--teal); outline-offset: -2px; border-radius: var(--radius-sm);
}
.term-body { flex: 1; position: relative; overflow: hidden; }
.pane-slot { position: absolute; inset: 0; }
/* Drop overlay over the live view, shown only mid-drag. z-index above the xterm
   slot so it catches the drop, but below the edge shoulders (z-index 5) so the far
   edges still spin off a new column. Faint hairline wash mirrors the edge zones. */
.pane-drop { position: absolute; inset: 0; z-index: 4; background: var(--hairline); }
.term-slot { position: absolute; inset: 0; padding: 6px; }
</style>
