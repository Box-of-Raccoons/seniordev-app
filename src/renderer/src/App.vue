<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, computed, watch } from 'vue'
import RightPanel from './components/RightPanel.vue'
import Sidebar from './components/Sidebar.vue'
import SubagentPanel from './components/SubagentPanel.vue'
import AboutModal from './components/AboutModal.vue'
import AppConfigModal from './components/AppConfigModal.vue'
import PromptConfigModal from './components/PromptConfigModal.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import Splash from './components/Splash.vue'
import { useSplash } from './composables/useSplash'
import { useWorkspace } from './composables/useWorkspace'
import { useSubagents } from './composables/useSubagents'
import type { MenuAction, DeepLink } from '../../shared/ipc'

// A3: the shared workspace state lives here (App is the common ancestor of the
// pane area and the S4 sidebar) and is passed to both. RightPanel still drives it;
// the sidebar (added in S4 Step 5) reads the same panes + statuses.
const ws = useWorkspace()
const rightPanel = ref<InstanceType<typeof RightPanel> | null>(null)

// S8: live subagent-activity store, owned here (App outlives a placement toggle,
// so the tiles survive moving the panel between the right rail and the bottom
// strip). The panel component is a pure view over this.
const subagents = useSubagents()
// The right-rail column sizing, mirroring sidebarStyle: a fixed flex-basis (a slim
// strip when collapsed, else the persisted size). Only used when placement=right.
const SUBAGENT_COLLAPSED_PX = 36
const subagentRightStyle = computed(() => ({
  flex: `0 0 ${ws.subagentPanel.collapsed ? SUBAGENT_COLLAPSED_PX : ws.subagentPanel.size}px`
}))
let offSidebarChanged: (() => void) | null = null
async function refreshKnownSessions(): Promise<void> {
  try {
    const convs = await window.api.listConversations()
    subagents.setKnownSessions(convs.map((c) => c.agentSessionId).filter((id): id is string => !!id))
    // Map each parent session id → its conversation title so a tile can name the
    // session that spawned it. Only this app's sessions have a title; others stay
    // unnamed in the panel.
    const names = new Map<string, string>()
    for (const c of convs) if (c.agentSessionId && c.title) names.set(c.agentSessionId, c.title)
    subagents.setSessionNames(names)
  } catch {
    // A read failure just leaves the known set as-is; the app-only filter degrades
    // to "show nothing extra", never a crash.
  }
}

// The sidebar column: 40px when collapsed, else its persisted width (264 default).
// A fixed flex-basis with no grow/shrink; RightPanel takes the remaining space.
const DEFAULT_SIDEBAR_WIDTH = 264
const sidebarStyle = computed(() => ({
  flex: `0 0 ${ws.sidebarCollapsed.value ? 40 : (ws.sidebarWidth.value ?? DEFAULT_SIDEBAR_WIDTH)}px`
}))
// Boot splash: shown from first paint, dismissed once startup work settles below.
const { visible: splashVisible, ready: splashReady, hide: splashHide } = useSplash()
const modal = ref<'about' | 'app-config' | 'prompt-config' | null>(null)
const confirmReset = ref(false)
let offMenu: (() => void) | null = null
let offDeepLink: (() => void) | null = null

function onMenu(action: MenuAction): void {
  if (action === 'new-session') {
    requestNewSession()
    return
  }
  if (action === 'move-tab-left' || action === 'move-tab-right') {
    rightPanel.value?.moveActiveTab(action === 'move-tab-left' ? -1 : 1)
    return
  }
  // One modal at a time: an action while any modal is open keeps the open one.
  if (modal.value === null && !confirmReset.value) modal.value = action
}

function requestNewSession(): void {
  if (modal.value !== null) return
  if (rightPanel.value?.hasSessions()) confirmReset.value = true
  else doReset()
}

function doReset(): void {
  rightPanel.value?.closeAll()
  rightPanel.value?.newTab()
  confirmReset.value = false
}

// A deep link prefills a composer with the ticket key; the developer reviews and
// launches it themselves (never guess-and-run). Richer params (role/folder/mode)
// are a future addition.
function handleDeepLink(link: DeepLink): void {
  rightPanel.value?.openComposer({ input: link.ticket, role: link.role, folder: link.folder })
}

// Keyboard pane moves. A menu accelerator loses to a focused xterm (it consumes
// the keydown), so this runs in the capture phase at the window level — ahead of
// the terminal's own textarea listener — and thus fires regardless of focus.
// Cmd/Ctrl+Shift+Left/Right moves the focused pane's active tab sideways.
function onPaneKeydown(e: KeyboardEvent): void {
  if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey) return
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  e.preventDefault()
  e.stopImmediatePropagation()
  rightPanel.value?.moveActiveTab(e.key === 'ArrowLeft' ? -1 : 1)
}

onMounted(async () => {
  offMenu = window.api.onMenuAction(onMenu)
  offDeepLink = window.api.onDeepLink(handleDeepLink)
  window.addEventListener('keydown', onPaneKeydown, true)
  // S8: begin watching subagent activity; mirror the persisted "this app only"
  // preference into the store's live filter, and keep the known-session set fresh.
  subagents.start()
  watch(() => ws.subagentPanel.appOnly, (v) => (subagents.appOnly.value = v), { immediate: true })
  void refreshKnownSessions()
  offSidebarChanged = window.api.onSidebarChanged(() => void refreshKnownSessions())
  // S4/S8: restore the persisted sidebar + subagent-panel geometry (window bounds
  // are restored main-side). Best-effort — a missing/failing read leaves defaults.
  try {
    const s = await window.api.getSidebarState?.()
    if (s) {
      ws.sidebarWidth.value = s.width
      ws.sidebarCollapsed.value = s.collapsed
      if (s.subagentPanel) Object.assign(ws.subagentPanel, s.subagentPanel)
    }
  } catch {
    // keep defaults
  }
  // Only now can main push deep links — anything sent earlier would be lost.
  window.api.deepLinkReady()
  try {
    const startup = await window.api.getStartup()
    if (startup.session) rightPanel.value?.startStartupSession(startup.session, startup.tickets[0])
    else if (startup.deeplink) handleDeepLink(startup.deeplink)
  } catch (err) {
    // Startup is best-effort: fall back to a fresh composer the user drives.
    console.error('Startup load failed:', err)
  } finally {
    // Boot lands on the empty state (the "no sessions yet" raccoon) when nothing
    // above opened a session — the user launches from a project in the sidebar.
    // A restored or deep-linked session still opens normally; we no longer force
    // a composer tab open on a cold start.
    splashReady()
  }
})

onBeforeUnmount(() => {
  offMenu?.()
  offDeepLink?.()
  offSidebarChanged?.()
  subagents.stop()
  window.removeEventListener('keydown', onPaneKeydown, true)
})
</script>

<template>
  <div class="shell">
    <Sidebar :ws="ws" :style="sidebarStyle" />
    <RightPanel ref="rightPanel" :ws="ws" :subagents="subagents" />
    <SubagentPanel
      v-if="ws.subagentPanel.placement === 'right'"
      :subagents="subagents"
      :ws="ws"
      :style="subagentRightStyle"
    />
  </div>
  <AboutModal v-if="modal === 'about'" @close="modal = null" />
  <AppConfigModal v-if="modal === 'app-config'" @close="modal = null" />
  <PromptConfigModal v-if="modal === 'prompt-config'" @close="modal = null" />
  <ConfirmDialog
    v-if="confirmReset"
    title="New Session"
    message="Close all sessions? Running sessions will be killed."
    confirm-label="Close all"
    @confirm="doReset"
    @cancel="confirmReset = false"
  />
  <Transition name="splash-fade">
    <Splash v-if="splashVisible" @dismiss="splashHide" />
  </Transition>
</template>
