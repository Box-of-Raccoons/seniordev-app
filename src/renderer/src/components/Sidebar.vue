<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, computed, nextTick } from 'vue'
import StatusGlyph from './StatusGlyph.vue'
import WorktreeTeardownDialog from './WorktreeTeardownDialog.vue'
import NewTabMenu from './NewTabMenu.vue'
import type { UseWorkspace } from '../composables/useWorkspace'
import {
  activeProjectsByRecency,
  archivedProjects,
  conversationsForProject,
  archivedConversationsForProject,
  capConversations,
  rowState,
  resumeTabSpec,
  composerTabSpec,
  openSessionTabSpec,
  terminalTabSpec,
  conversationDragPayload,
  teardownOffersWorktree,
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
// The default shell for an instant Terminal launch, and the detected agent tools
// (for the New Session submenu). Resolved once on mount (S6).
const defaultShell = ref('')
const tools = ref<string[]>([])
onMounted(() => {
  void refresh()
  // Main nudges on any stored change (a spawn, codex id discovery, archive/restore).
  offChange = window.api.onSidebarChanged(() => void refresh())
  window.api
    .listShells()
    .then((s) => (defaultShell.value = s.default))
    .catch(() => (defaultShell.value = ''))
  window.api
    .listTools()
    .then((t) => (tools.value = t))
    .catch(() => (tools.value = []))
  window.api
    .getSidebarState()
    .then((s) => (suppressTeardownConfirm.value = s.suppressTeardownConfirm))
    .catch(() => {})
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
  // Light up the pane drop targets (edge shoulders + per-pane overlay) for this drag.
  props.ws.draggingConversation.value = true
}
function onRowDragEnd(): void {
  props.ws.draggingConversation.value = false
}

// S5 teardown: archive a conversation and optionally remove its worktree. The
// dialog owns the confirm + the opt-in worktree checkbox; a removal failure (a
// dirty tree) is reported without blocking the archive.
const teardownConv = ref<ConversationInfo | null>(null)
const teardownFailure = ref<string | null>(null)
// S7: "Don't ask again" for no-worktree archives, read on mount + persisted on use.
const suppressTeardownConfirm = ref(false)
function openTeardown(conv: ConversationInfo): void {
  // S7: with the preference set, a no-worktree archive skips the dialog entirely.
  // A worktree conversation always confirms (removal is a real, destructive choice).
  if (suppressTeardownConfirm.value && !conv.worktreePath) {
    void window.api
      .teardownConversation({ conversationId: conv.id, removeWorktree: false })
      .then(() => refresh())
      .catch(() => {})
    return
  }
  teardownConv.value = conv
  teardownFailure.value = null
}
function cancelTeardown(): void {
  teardownConv.value = null
  teardownFailure.value = null
}
async function confirmTeardown(payload: { removeWorktree: boolean; dontAskAgain: boolean }): Promise<void> {
  const conv = teardownConv.value
  if (!conv) return
  if (payload.dontAskAgain) {
    suppressTeardownConfirm.value = true
    void window.api.setSuppressTeardownConfirm(true)
  }
  try {
    const res = await window.api.teardownConversation({ conversationId: conv.id, removeWorktree: payload.removeWorktree })
    // A worktree-removal failure keeps the dialog open reporting the reason; the
    // archive has already applied, so refresh drops the row from the list.
    if (res.worktree && !res.worktree.ok) {
      teardownFailure.value = res.worktree.error ?? 'unknown error'
      void refresh()
      return
    }
  } catch {
    // A teardown IPC failure is non-fatal; leave the dialog open with a note.
    teardownFailure.value = 'teardown failed'
    return
  }
  teardownConv.value = null
  void refresh()
}

async function restoreProject(id: string): Promise<void> {
  await window.api.setProjectArchived(id, false)
  // Main emits SIDEBAR.changed → refresh() repartitions; refresh here too so the
  // row moves immediately even if the event is delayed.
  void refresh()
}

// S6: launch directly into a project. AI opens a folder-locked composer; Open and
// Terminal spawn immediately. Everything opens into the LEFTMOST pane (never
// surprise-open where the user is not looking); a drag targets a specific pane.
function launchInProject(
  project: ProjectInfo,
  pick: { variant: 'agent' | 'terminal'; mode?: 'task' | 'open'; tool?: string }
): void {
  const left = props.ws.panes.leftmostPaneId.value
  if (pick.variant === 'terminal') {
    props.ws.panes.addTab(terminalTabSpec(project, defaultShell.value || 'bash'), left)
  } else if (pick.mode === 'open') {
    // pick.tool is set when the Open submenu chose an agent; else the project default.
    props.ws.panes.addTab(openSessionTabSpec(project, pick.tool), left)
  } else {
    props.ws.panes.addTab(composerTabSpec(project), left)
  }
}

// Per-project launcher menu refs, so New Project can pop the new row's menu.
const menuRefs = new Map<string, { openMenu: () => void }>()
function setMenuRef(id: string, el: unknown): void {
  if (el) menuRefs.set(id, el as { openMenu: () => void })
  else menuRefs.delete(id)
}

// New Project: pick a folder, create/refresh the project, then open its launcher so
// the flow is folder -> choose -> running in one motion.
async function newProject(): Promise<void> {
  const folder = await window.api.pickFolder()
  if (!folder) return
  const project = await window.api.ensureProject(folder)
  await refresh()
  collapsedProjects.delete(project.id) // ensure it is expanded
  await nextTick()
  menuRefs.get(project.id)?.openMenu()
}

// Archived-conversations reveal (S6 restore), per project.
const archivedConvOpen = reactive(new Set<string>())
function toggleArchivedConvs(projectId: string): void {
  if (archivedConvOpen.has(projectId)) archivedConvOpen.delete(projectId)
  else archivedConvOpen.add(projectId)
}
function archivedConvsFor(projectId: string): ConversationInfo[] {
  return archivedConversationsForProject(conversations.value, projectId)
}
async function restoreConversation(id: string): Promise<void> {
  await window.api.setConversationArchived(id, false)
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
  <div class="sb-host">
    <!-- Single root (this div) so App's :style (flex: 0 0 <width>px) falls through
         onto it. The teardown dialog is a sibling of the rail/sidebar INSIDE this
         root, not a third template root; multiple template roots would make the
         component a fragment and drop that flex sizing, collapsing the work area. -->
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
      <button class="new-project" @click="newProject">
        <span class="new-project__plus" aria-hidden="true">+</span> New project
      </button>

      <p v-if="!activeProjects.length" class="sb-empty">No projects yet. Start one with "New project".</p>

      <template v-for="project in activeProjects" :key="project.id">
        <div class="proj-row">
          <button class="proj" :aria-expanded="isExpanded(project.id)" @click="toggleProject(project.id)">
            <span class="tw" :class="{ 'tw--open': isExpanded(project.id) }">▸</span>
            <span class="name">{{ project.title }}</span>
            <span class="count">{{ projectConversations(project.id).length }}</span>
          </button>
          <NewTabMenu
            :ref="(el) => setMenuRef(project.id, el)"
            ghost
            :tools="tools"
            @pick="launchInProject(project, $event)"
          />
        </div>

        <div v-if="isExpanded(project.id)" class="convs">
          <div v-for="conv in capView(project.id).visible" :key="conv.id" class="conv-row">
            <button
              class="conv"
              :class="convClasses(conv)"
              :disabled="isInert(conv)"
              :draggable="!isInert(conv)"
              @click="clickConversation(conv)"
              @dragstart="onRowDragStart($event, conv)"
              @dragend="onRowDragEnd"
            >
              <span class="glyph-cell"><StatusGlyph :status="glyphFor(conv)" /></span>
              <span class="label">{{ conv.title || 'session' }}</span>
              <span class="tool">{{ conv.tool }}</span>
              <span v-if="isInert(conv)" class="tag">no resume</span>
            </button>
            <button
              class="conv-x"
              :aria-label="`Archive ${conv.title || 'session'}`"
              title="Archive conversation"
              @click.stop="openTeardown(conv)"
            >×</button>
          </div>
          <button
            v-if="capView(project.id).next"
            class="showmore"
            @click="advanceCap(project.id, capView(project.id).next!)"
          >
            {{ capLabel(capView(project.id).next!, capView(project.id).visible.length, capView(project.id).total) }}
          </button>

          <!-- S6: archived conversations, revealed on demand, each restorable. -->
          <template v-if="archivedConvsFor(project.id).length">
            <button
              class="arch-convs-head"
              :aria-expanded="archivedConvOpen.has(project.id)"
              @click="toggleArchivedConvs(project.id)"
            >
              <span class="tw" :class="{ 'tw--open': archivedConvOpen.has(project.id) }">▸</span>
              Archived ({{ archivedConvsFor(project.id).length }})
            </button>
            <div v-if="archivedConvOpen.has(project.id)" class="arch-convs">
              <div v-for="conv in archivedConvsFor(project.id)" :key="conv.id" class="arch-conv-row">
                <span class="label">{{ conv.title || 'session' }}</span>
                <button class="restore" @click="restoreConversation(conv.id)">Restore</button>
              </div>
            </div>
          </template>
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

  <!-- S5 teardown confirm (archive + optional worktree removal). -->
  <WorktreeTeardownDialog
    v-if="teardownConv"
    :title="`Archive ${teardownConv.title || 'session'}?`"
    :worktree-path="teardownOffersWorktree(teardownConv) ? teardownConv.worktreePath : null"
    :failure="teardownFailure"
    @confirm="confirmTeardown"
    @cancel="cancelTeardown"
  />
  </div>
</template>

<style scoped>
/* Single template root that App sizes via a fallthrough flex style; the rail or
   sidebar fills it. A plain flex column so the active aside stretches to full
   height. */
.sb-host { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; }
.sb-host > .rail, .sb-host > .sidebar { flex: 1; min-height: 0; }

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

/* New Project: the sidebar's one prominent action. Kept restrained (ghost with a
   hairline), not teal, to respect the One Signal Rule across the app. */
.new-project {
  display: flex; align-items: center; gap: 6px; width: 100%; margin-bottom: 6px;
  padding: 7px 10px; border: 1px solid var(--hairline-strong); background: transparent;
  color: var(--ink-soft); font: inherit; font-size: 13px; font-weight: 600;
  border-radius: var(--radius-sm); cursor: pointer; text-align: left;
}
.new-project:hover { color: var(--ink); background: var(--surface); }
.new-project:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; }
.new-project__plus { color: var(--ink-muted); font-size: 15px; line-height: 1; }

/* Project row: the expand button + the per-project launcher beside it. */
.proj-row { display: flex; align-items: center; }
.proj-row .proj { flex: 1; min-width: 0; }

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
/* Row wrapper: the conversation button + a hover/focus teardown control. The
   control can't nest inside the button (invalid HTML), so it sits beside it. */
.conv-row { position: relative; display: flex; align-items: stretch; }
.conv-row .conv { flex: 1; min-width: 0; }
.conv-x {
  position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
  background: var(--surface-2); border: 0; color: var(--ink-muted);
  width: 20px; height: 20px; border-radius: var(--radius-sm); cursor: pointer;
  line-height: 1; font-size: 14px; opacity: 0;
  display: inline-flex; align-items: center; justify-content: center;
}
.conv-row:hover .conv-x, .conv-x:focus-visible { opacity: 1; }
.conv-x:hover { color: var(--ink); }
.conv-x:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; }
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

/* Archived conversations reveal (S6 restore), nested under a project. */
.arch-convs-head {
  display: flex; align-items: center; gap: 6px; margin: 2px 0 2px 26px; padding: 3px 6px;
  background: transparent; border: 0; color: var(--ink-muted);
  font-family: var(--font-mono, Consolas, monospace); font-size: 11px; cursor: pointer;
  border-radius: 6px; text-align: left;
}
.arch-convs-head:hover { color: var(--ink-soft); background: var(--surface); }
.arch-convs-head:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; }
.arch-convs { display: flex; flex-direction: column; gap: 1px; }
.arch-conv-row { display: flex; align-items: center; gap: 8px; padding: 4px 8px 4px 34px; color: var(--ink-muted); font-size: 13px; }
.arch-conv-row .label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

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
