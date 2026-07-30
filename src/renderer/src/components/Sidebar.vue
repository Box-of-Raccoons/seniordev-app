<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, computed } from 'vue'
import StatusGlyph from './StatusGlyph.vue'
import type { UseWorkspace } from '../composables/useWorkspace'
import {
  activeProjectsByRecency,
  archivedProjects,
  conversationsForProject,
  capConversations,
  rowState,
  resumeTabSpec,
  conversationDragPayload,
  CONVERSATION_DND_TYPE,
  type CapLevel
} from '../composables/sidebar-logic'
import type { ProjectInfo, ConversationInfo, TabStatus } from '../../../shared/ipc'

// S4 Projects sidebar (spec section 8). A sibling of RightPanel under App, reading
// the shared `ws` (A3): projects sorted by recency, each expanding to its capped
// conversations; open rows lift to surface-2 (a tonal step, never a colour
// stripe); the status glyph is a separate signal from the open state; a
// conversation with no live tab is dimmed, and a non-resumable one (agentSessionId
// null) is inert. Clicking focuses a live tab wherever it lives, or resumes a dead
// one into the leftmost pane. Sidebar width + collapsed persist via ws.
const props = defineProps<{ ws: UseWorkspace }>()

const MIN_WIDTH = 180
const MAX_WIDTH = 480

const projects = ref<ProjectInfo[]>([])
const conversations = ref<ConversationInfo[]>([])

// Projects default to expanded; track the collapsed ones so a fresh project (after
// a refresh) shows its conversations without needing a click.
const collapsedProjects = reactive(new Set<string>())
const capLevels = reactive<Record<string, CapLevel>>({})
const archivedOpen = ref(false)

let offChange: (() => void) | null = null
async function refresh(): Promise<void> {
  try {
    const [p, c] = await Promise.all([window.api.listProjects(), window.api.listConversations()])
    projects.value = p
    conversations.value = c
  } catch {
    // A read failure must never blank the sidebar mid-session; keep the last data.
  }
}
onMounted(() => {
  void refresh()
  // Main nudges on any stored change (a spawn, codex id discovery, archive/restore).
  offChange = window.api.onSidebarChanged(() => void refresh())
})
onBeforeUnmount(() => offChange?.())

const activeProjects = computed(() => activeProjectsByRecency(projects.value))
const archived = computed(() => archivedProjects(projects.value))

function projectConversations(projectId: string): ConversationInfo[] {
  return conversationsForProject(conversations.value, projectId)
}
function isExpanded(id: string): boolean {
  return !collapsedProjects.has(id)
}
function toggleProject(id: string): void {
  if (collapsedProjects.has(id)) collapsedProjects.delete(id)
  else collapsedProjects.add(id)
}

// Per-project cap (5 → show more → 10 → show all → everything).
function capView(projectId: string): { visible: ConversationInfo[]; next: CapLevel | null; total: number } {
  const all = projectConversations(projectId)
  const { visible, next } = capConversations(all, capLevels[projectId] ?? 'collapsed')
  return { visible, next, total: all.length }
}
function advanceCap(projectId: string, next: CapLevel): void {
  capLevels[projectId] = next
}
function capLabel(next: CapLevel, shown: number, total: number): string {
  return `${next === 'more' ? 'show more' : 'show all'} (${shown} of ${total})`
}

// One row's derived state: is it open (a live tab), where, and is it resumable.
function liveFor(conv: ConversationInfo): { ptyId: string; paneId: string } | null {
  return props.ws.panes.findByConversationId(conv.id)
}
function stateFor(conv: ConversationInfo): ReturnType<typeof rowState> {
  return rowState(conv, liveFor(conv))
}
function glyphFor(conv: ConversationInfo): TabStatus | null {
  const s = stateFor(conv)
  return s.open && s.ptyId ? (props.ws.statuses[s.ptyId] ?? null) : null
}
function isInert(conv: ConversationInfo): boolean {
  const s = stateFor(conv)
  return !s.open && !s.resumable
}
function convClasses(conv: ConversationInfo): Record<string, boolean> {
  const s = stateFor(conv)
  return { open: s.open, dim: !s.open, noresume: !s.open && !s.resumable }
}

// Click: focus a live tab wherever it lives; else resume a dead-but-resumable one
// into the LEFTMOST pane (focus is invisible state — never surprise-open where the
// user is not looking). A non-resumable, non-open row does nothing (button disabled).
function clickConversation(conv: ConversationInfo): void {
  const s = stateFor(conv)
  if (s.open && s.paneId && s.ptyId) {
    props.ws.panes.focusTab(s.paneId, s.ptyId)
    return
  }
  if (!s.resumable || !conv.agentSessionId) return
  // Resume into the LEFTMOST pane (focus is invisible state; never surprise-open
  // where the user is not looking). A drag targets a specific pane instead.
  props.ws.panes.addTab(
    resumeTabSpec({ id: conv.id, title: conv.title, tool: conv.tool, cwd: conv.cwd, agentSessionId: conv.agentSessionId }),
    props.ws.panes.leftmostPaneId.value
  )
}

// Drag a row into a specific pane (RightPanel handles the drop). The payload
// carries what a resume needs; the distinct type lets a pane tell this from a
// tab-reorder drop. Inert rows are not draggable (nothing to focus or resume).
function onRowDragStart(e: DragEvent, conv: ConversationInfo): void {
  if (!e.dataTransfer) return
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData(CONVERSATION_DND_TYPE, JSON.stringify(conversationDragPayload(conv)))
}

async function restoreProject(id: string): Promise<void> {
  await window.api.setProjectArchived(id, false)
  // Main emits SIDEBAR.changed → refresh() repartitions; refresh here too so the
  // row moves immediately even if the event is delayed.
  void refresh()
}

// Collapsed rail keeps live status visible at a glance.
const railGlyphs = computed<TabStatus[]>(() =>
  props.ws.panes.allTabs.value
    .map(({ tab }) => props.ws.statuses[tab.ptyId])
    .filter((s): s is TabStatus => !!s)
)

function collapse(): void {
  props.ws.sidebarCollapsed.value = true
}
function expand(): void {
  props.ws.sidebarCollapsed.value = false
}

// Drag the right edge to resize; width persists through ws → workspace.json.
let dragging = false
let startX = 0
let startWidth = 0
function onGripDown(e: PointerEvent): void {
  dragging = true
  startX = e.clientX
  startWidth = props.ws.sidebarWidth.value ?? 264
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  e.preventDefault()
}
function onGripMove(e: PointerEvent): void {
  if (!dragging) return
  const w = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + (e.clientX - startX)))
  props.ws.sidebarWidth.value = w
}
function onGripUp(e: PointerEvent): void {
  dragging = false
  try {
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
  } catch {
    // capture may already be gone
  }
}
// Keyboard resize (WCAG operability, matching the S2 pane splitter): arrow keys
// nudge the width by a fixed step within the same min/max bounds as the drag.
function onGripKey(e: KeyboardEvent): void {
  const step = 16
  const cur = props.ws.sidebarWidth.value ?? 264
  if (e.key === 'ArrowLeft') props.ws.sidebarWidth.value = Math.max(MIN_WIDTH, cur - step)
  else if (e.key === 'ArrowRight') props.ws.sidebarWidth.value = Math.min(MAX_WIDTH, cur + step)
  else return
  e.preventDefault()
}
</script>

<template>
  <!-- Collapsed: a slim rail with an expand control and the live glyphs. -->
  <aside v-if="ws.sidebarCollapsed.value" class="rail" aria-label="Projects (collapsed)">
    <button class="icon-btn" aria-label="Expand sidebar" title="Expand sidebar" @click="expand">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3.5 L10.5 8 L6 12.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <div class="rail-dots">
      <StatusGlyph v-for="(g, i) in railGlyphs" :key="i" :status="g" />
    </div>
  </aside>

  <!-- Expanded sidebar. -->
  <aside v-else class="sidebar" aria-label="Projects">
    <div class="sb-head">
      <span class="sb-title">Projects</span>
      <button class="icon-btn" aria-label="Collapse sidebar" title="Collapse sidebar" @click="collapse">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3.5 L5.5 8 L10 12.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>

    <div class="sb-scroll">
      <p v-if="!activeProjects.length" class="sb-empty">No projects yet. Launch a session to start one.</p>

      <template v-for="project in activeProjects" :key="project.id">
        <button class="proj" :aria-expanded="isExpanded(project.id)" @click="toggleProject(project.id)">
          <span class="tw" :class="{ 'tw--open': isExpanded(project.id) }">▸</span>
          <span class="name">{{ project.title }}</span>
          <span class="count">{{ projectConversations(project.id).length }}</span>
        </button>

        <div v-if="isExpanded(project.id)" class="convs">
          <button
            v-for="conv in capView(project.id).visible"
            :key="conv.id"
            class="conv"
            :class="convClasses(conv)"
            :disabled="isInert(conv)"
            :draggable="!isInert(conv)"
            @click="clickConversation(conv)"
            @dragstart="onRowDragStart($event, conv)"
          >
            <span class="glyph-cell"><StatusGlyph :status="glyphFor(conv)" /></span>
            <span class="label">{{ conv.title || 'session' }}</span>
            <span class="tool">{{ conv.tool }}</span>
            <span v-if="isInert(conv)" class="tag">no resume</span>
          </button>
          <button
            v-if="capView(project.id).next"
            class="showmore"
            @click="advanceCap(project.id, capView(project.id).next!)"
          >
            {{ capLabel(capView(project.id).next!, capView(project.id).visible.length, capView(project.id).total) }}
          </button>
        </div>
      </template>
    </div>

    <div v-if="archived.length" class="archived">
      <button class="arch-head" :aria-expanded="archivedOpen" @click="archivedOpen = !archivedOpen">
        <span class="tw" :class="{ 'tw--open': archivedOpen }">▸</span>
        <span class="name">Archived ({{ archived.length }})</span>
      </button>
      <div v-if="archivedOpen" class="arch-list">
        <div v-for="project in archived" :key="project.id" class="arch-row">
          <span class="label">{{ project.title }}</span>
          <button class="restore" @click="restoreProject(project.id)">Restore</button>
        </div>
      </div>
    </div>

    <div
      class="sb-grip"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar (arrow keys)"
      tabindex="0"
      @pointerdown="onGripDown"
      @pointermove="onGripMove"
      @pointerup="onGripUp"
      @keydown="onGripKey"
    ></div>
  </aside>
</template>

<style scoped>
/* The sidebar sits on the deepest plane (bg) so it reads as recessed against the
   work area (surface); an open row lifts to surface-2 (DESIGN Tone-First). */
.sidebar {
  position: relative; height: 100%; width: 100%;
  background: var(--bg); border-right: 1px solid var(--hairline);
  display: flex; flex-direction: column; min-height: 0;
  font-family: var(--font-ui, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif);
}
.sb-head {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 8px 10px 12px; border-bottom: 1px solid var(--hairline);
}
.sb-title { font-size: 13px; font-weight: 600; color: var(--ink-soft); flex: 1; }

.icon-btn {
  background: transparent; border: 0; color: var(--ink-muted); cursor: pointer;
  width: 26px; height: 26px; border-radius: var(--radius-sm);
  display: inline-flex; align-items: center; justify-content: center;
}
.icon-btn:hover { color: var(--ink); background: var(--surface); }
.icon-btn:focus-visible { outline: 2px solid var(--teal); outline-offset: 2px; }

.sb-scroll { overflow-y: auto; padding: 6px 6px 12px; flex: 1; min-height: 0; }
.sb-empty { color: var(--ink-muted); font-size: 13px; padding: 10px 10px; margin: 0; }

.proj {
  display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 6px 8px; border: 0; background: transparent; cursor: pointer;
  color: var(--ink-soft); font: inherit; font-size: 13px; font-weight: 600;
  border-radius: var(--radius-sm); text-align: left;
}
.proj:hover { background: var(--surface); color: var(--ink); }
.proj:focus-visible { outline: 2px solid var(--teal); outline-offset: -2px; }
.tw {
  color: var(--ink-muted); font-size: 10px; width: 10px; display: inline-block;
  transition: transform 120ms var(--ease-out);
}
.tw--open { transform: rotate(90deg); }
.proj .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.proj .count { color: var(--ink-muted); font-family: var(--font-mono, Consolas, monospace); font-size: 11px; }

.convs { display: flex; flex-direction: column; gap: 1px; margin: 1px 0 4px; }
.conv {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 8px 5px 26px; border-radius: var(--radius-sm);
  cursor: pointer; color: var(--ink-soft); background: transparent;
  border: 0; width: 100%; text-align: left; font: inherit; font-size: 13px;
}
.conv:hover { background: var(--surface); }
.conv:focus-visible { outline: 2px solid var(--teal); outline-offset: -2px; }
/* OPEN: one tonal step up to surface-2 (no colour, no stripe). */
.conv.open { background: var(--surface-2); color: var(--ink); }
.conv.open:hover { background: var(--surface-2); }
/* No live tab → dimmed. */
.conv.dim { color: var(--ink-muted); }
/* Non-resumable → dimmed and inert (button disabled). */
.conv.noresume { cursor: default; }
.conv:disabled { cursor: default; }
.glyph-cell { width: 14px; height: 14px; flex: 0 0 14px; display: inline-flex; align-items: center; justify-content: center; }
.conv .label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Which agent this conversation is (claude / codex) — a quiet, always-present
   hint so the two are distinguishable at a glance. */
.conv .tool { font-family: var(--font-mono, Consolas, monospace); font-size: 10px; color: var(--ink-muted); opacity: 0.75; flex: 0 0 auto; }
.conv .tag { font-family: var(--font-mono, Consolas, monospace); font-size: 10.5px; color: var(--ink-muted); flex: 0 0 auto; }

.showmore {
  margin: 2px 0 2px 26px; padding: 3px 6px; background: transparent; border: 0;
  color: var(--ink-muted); font-family: var(--font-mono, Consolas, monospace); font-size: 11px;
  cursor: pointer; border-radius: 6px; text-align: left;
}
.showmore:hover { color: var(--ink-soft); background: var(--surface); }
.showmore:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; }

.archived { border-top: 1px solid var(--hairline); padding: 6px; }
.arch-head {
  display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 6px 8px; border: 0; background: transparent; cursor: pointer;
  color: var(--ink-muted); font: inherit; font-size: 13px; font-weight: 600;
  border-radius: var(--radius-sm); text-align: left;
}
.arch-head:hover { background: var(--surface); color: var(--ink-soft); }
.arch-head:focus-visible { outline: 2px solid var(--teal); outline-offset: -2px; }
.arch-row { display: flex; align-items: center; gap: 8px; padding: 5px 8px 5px 26px; color: var(--ink-muted); font-size: 13px; }
.arch-row .label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.restore {
  background: transparent; border: 1px solid var(--hairline-strong); color: var(--ink-soft);
  font: inherit; font-size: 11px; padding: 2px 8px; border-radius: var(--radius-sm); cursor: pointer;
}
.restore:hover { color: var(--ink); }
.restore:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; }

/* Right-edge resize gripper: a hairline that strengthens on hover. */
.sb-grip { position: absolute; top: 0; right: -3px; bottom: 0; width: 7px; cursor: col-resize; touch-action: none; z-index: 2; }
.sb-grip::before { content: ''; position: absolute; top: 0; bottom: 0; left: 3px; width: 1px; background: var(--hairline); }
.sb-grip:hover::before { background: var(--hairline-strong); left: 2px; width: 3px; }
.sb-grip:focus-visible { outline: 2px solid var(--teal); outline-offset: -2px; }

/* Collapsed rail. */
.rail {
  height: 100%; width: 100%; background: var(--bg); border-right: 1px solid var(--hairline);
  display: flex; flex-direction: column; align-items: center; padding-top: 10px; gap: 12px;
}
.rail .icon-btn { color: var(--ink-soft); }
.rail-dots { display: flex; flex-direction: column; gap: 10px; margin-top: 6px; align-items: center; }

@media (prefers-reduced-motion: reduce) {
  .tw { transition: none; }
}
</style>
