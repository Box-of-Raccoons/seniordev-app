<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, computed } from 'vue'
import RightPanel from './components/RightPanel.vue'
import Sidebar from './components/Sidebar.vue'
import AboutModal from './components/AboutModal.vue'
import AppConfigModal from './components/AppConfigModal.vue'
import PromptConfigModal from './components/PromptConfigModal.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import Splash from './components/Splash.vue'
import { useSplash } from './composables/useSplash'
import { useWorkspace } from './composables/useWorkspace'
import type { MenuAction, DeepLink } from '../../shared/ipc'

// A3: the shared workspace state lives here (App is the common ancestor of the
// pane area and the S4 sidebar) and is passed to both. RightPanel still drives it;
// the sidebar (added in S4 Step 5) reads the same panes + statuses.
const ws = useWorkspace()
const rightPanel = ref<InstanceType<typeof RightPanel> | null>(null)

// The sidebar column: 40px when collapsed, else its persisted width (264 default).
// A fixed flex-basis with no grow/shrink; RightPanel takes the remaining space.
const DEFAULT_SIDEBAR_WIDTH = 264
const sidebarStyle = computed(() => ({
  flex: `0 0 ${ws.sidebarCollapsed.value ? 40 : (ws.sidebarWidth.value ?? DEFAULT_SIDEBAR_WIDTH)}px`
}))
// Boot splash: shown from first paint, dismissed once startup work settles below.
const { visible: splashVisible, ready: splashReady } = useSplash()
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
  // S4: restore the persisted sidebar geometry (window bounds are restored
  // main-side). Best-effort — a missing/failing read leaves the defaults.
  try {
    const s = await window.api.getSidebarState?.()
    if (s) {
      ws.sidebarWidth.value = s.width
      ws.sidebarCollapsed.value = s.collapsed
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
    // Always land on a launch surface: if nothing above opened a session, open a
    // composer tab so the app never boots into an empty room.
    if (!rightPanel.value?.hasSessions()) rightPanel.value?.newTab()
    splashReady()
  }
})

onBeforeUnmount(() => {
  offMenu?.()
  offDeepLink?.()
  window.removeEventListener('keydown', onPaneKeydown, true)
})
</script>

<template>
  <div class="shell">
    <Sidebar :ws="ws" :style="sidebarStyle" />
    <RightPanel ref="rightPanel" :ws="ws" />
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
    <Splash v-if="splashVisible" />
  </Transition>
</template>
