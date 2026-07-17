<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import RightPanel from './components/RightPanel.vue'
import AboutModal from './components/AboutModal.vue'
import AppConfigModal from './components/AppConfigModal.vue'
import PromptConfigModal from './components/PromptConfigModal.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import Splash from './components/Splash.vue'
import { useSplash } from './composables/useSplash'
import type { MenuAction, DeepLink } from '../../shared/ipc'

const rightPanel = ref<InstanceType<typeof RightPanel> | null>(null)
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
  rightPanel.value?.openComposer({ input: link.ticket })
}

onMounted(async () => {
  offMenu = window.api.onMenuAction(onMenu)
  offDeepLink = window.api.onDeepLink(handleDeepLink)
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
})
</script>

<template>
  <div class="shell">
    <RightPanel ref="rightPanel" />
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
