<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import TerminalView from './TerminalView.vue'
import YoloView from './YoloView.vue'
import Composer from './Composer.vue'
import NewTabMenu from './NewTabMenu.vue'
import EmptyState from './EmptyState.vue'
import StatusGlyph from './StatusGlyph.vue'
import raccoonAsleepUrl from '../assets/raccoon-asleep.png'
import { shouldNotify, notificationText } from '../status-notify'
import { usePanes, type LiveTab } from '../composables/usePanes'
import type { ComposerLaunch } from './composer-types'
import type { TabStatus } from '../../../shared/ipc'

interface Prefill {
  input?: string
  folder?: string
  role?: string
}

// S2: the tab + pane model lives in usePanes (spec section 6.4); RightPanel is
// layout + the S1 status/notification glue. Step 2 renders a single pane; the
// v-for over panes and the resize splitters land in Step 4.
const panes = usePanes()
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
// Drop onto a specific tab: insert the dragged tab at that tab's position.
function onDropOnTab(e: DragEvent, paneId: string, beforePtyId: string): void {
  const id = dragId(e)
  draggingPtyId.value = null
  if (!id || id === beforePtyId) return
  const pane = panes.panes.find((p) => p.id === paneId)
  const idx = pane?.tabs.findIndex((t) => t.ptyId === beforePtyId)
  panes.moveTab(id, paneId, idx)
}
// Drop onto empty strip space: append to that pane.
function onDropOnStrip(e: DragEvent, paneId: string): void {
  const id = dragId(e)
  draggingPtyId.value = null
  if (id) panes.moveTab(id, paneId)
}
// Drop onto a window edge: spin off a new column there.
function onDropEdge(e: DragEvent, side: 'left' | 'right'): void {
  const id = dragId(e)
  draggingPtyId.value = null
  if (id) panes.moveToNewPane(id, side)
}

// Live per-tab status (S1), keyed by ptyId — which is the id the main process
// reports on STATUS.update. A tab with no entry (composer, or nothing running
// yet) shows no glyph. Independent of pane layout, so a dragged tab keeps its
// glyph: the lookup is by ptyId, which a moved tab retains (spec section 3).
const statuses = reactive<Record<string, TabStatus>>({})
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

// Programmatic new tab (boot / reset / deep-link): a default agent composer on
// the default CLI tool. The New-tab menu drives the explicit tool/terminal choice.
function newTab(): void {
  panes.addTab({ title: 'New session', kind: 'composer', variant: 'agent' })
}

// The menu picks agent-vs-terminal (the agent CLI is chosen later in the
// composer's tool picker) plus, for the Open item, the composer's start mode.
function onPick(p: { variant: 'agent' | 'terminal'; mode?: 'task' | 'open' }, paneId?: string): void {
  const title = p.variant === 'terminal' ? 'New shell' : p.mode === 'open' ? 'Open session' : 'New session'
  panes.addTab({ title, kind: 'composer', variant: p.variant, initialMode: p.mode }, paneId)
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
  t.cwdOverride = p.folder
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
function startStartupSession(
  s: { mode: 'interactive' | 'yolo'; promptName?: string; promptText?: string; tool?: string },
  ticketKey?: string
): void {
  const prompt = s.promptName ? { name: s.promptName } : s.promptText ? { text: s.promptText } : undefined
  startupSeq += 1
  panes.addTab({
    title: `${s.promptName ?? (s.mode === 'yolo' ? 'yolo' : 'session')} ${startupSeq}`,
    kind: s.mode === 'yolo' ? 'yolo' : 'terminal',
    prompt,
    tool: s.tool,
    ticketKey,
    input: ticketKey
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

defineExpose({ newTab, openComposer, startStartupSession, closeAll, hasSessions, moveActiveTab })

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

function markExited(id: string): void {
  panes.markExited(id)
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
        v-show="draggingPtyId"
        class="pane-edge pane-edge--left"
        @dragover.prevent
        @drop="onDropEdge($event, 'left')"
      ></div>
      <div
        v-show="draggingPtyId"
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
                <button class="term-tab__close" :aria-label="`Close ${tab.title}`" @click="closeTerm(tab.ptyId)">×</button>
              </div>
            </nav>
            <!-- + sits right after the last tab (Windows Terminal style): dropping
                 flex:1 on .term-tabs stops the tabs stretching and shoving it right. -->
            <NewTabMenu @pick="onPick($event, pane.id)" />
          </div>

          <div class="term-body">
            <EmptyState v-if="!pane.tabs.length" :image="raccoonAsleepUrl" caption='No sessions yet. Start one with "+".' />
            <div class="pane-slot" :ref="(el) => setSlot(pane.id, el as Element | null)"></div>
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

    <!-- Flat teleport list: every tab's content is mounted exactly once here and
         teleported into its pane's slot. Moving a tab changes the teleport target,
         not its position in this list, so xterm is never unmounted and scrollback
         survives (spec section 6.3). -->
    <template v-for="entry in allTabs" :key="entry.tab.ptyId">
      <Teleport :to="slotEls[entry.paneId]" :disabled="!slotEls[entry.paneId]">
        <div v-show="isVisible(entry.paneId, entry.tab.ptyId)" class="term-slot">
          <Composer
            v-if="entry.tab.kind === 'composer'"
            :variant="entry.tab.variant ?? 'agent'"
            :initial-mode="entry.tab.initialMode"
            :tool="entry.tab.tool"
            :initial-input="entry.tab.prefill?.input"
            :initial-folder="entry.tab.prefill?.folder"
            :initial-role="entry.tab.prefill?.role"
            @launch="launch(entry.tab, $event)"
          />
          <YoloView
            v-else-if="entry.tab.kind === 'yolo'"
            :id="entry.tab.ptyId"
            :ticket-key="entry.tab.ticketKey ?? null"
            :input="entry.tab.input"
            :prompt="entry.tab.prompt"
            :tool="entry.tab.tool"
            @exited="markExited(entry.tab.ptyId)"
            @resume="resumeYolo(entry.tab, $event)"
          />
          <TerminalView
            v-else-if="entry.tab.kind === 'shell'"
            :id="entry.tab.ptyId"
            :shell="entry.tab.shell"
            :cwd-override="entry.tab.cwdOverride"
            @exited="markExited(entry.tab.ptyId)"
          />
          <TerminalView
            v-else
            :id="entry.tab.ptyId"
            :conversation-id="entry.tab.conversationId"
            :ticket-key="entry.tab.ticketKey ?? null"
            :input="entry.tab.input"
            :prompt="entry.tab.prompt"
            :tool="entry.tab.tool"
            :resume="entry.tab.resume"
            :cwd-override="entry.tab.cwdOverride"
            @exited="markExited(entry.tab.ptyId)"
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
.term-slot { position: absolute; inset: 0; padding: 6px; }
</style>
