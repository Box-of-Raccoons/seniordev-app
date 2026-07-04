<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import LeftPanel from './components/LeftPanel.vue'
import RightPanel from './components/RightPanel.vue'
import AboutModal from './components/AboutModal.vue'
import AppConfigModal from './components/AppConfigModal.vue'
import PromptConfigModal from './components/PromptConfigModal.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import Splash from './components/Splash.vue'
import { useResizableSplit } from './composables/useResizableSplit'
import { useSplash } from './composables/useSplash'
import type { MenuAction, DeepLink } from '../../shared/ipc'

const activeTicketKey = ref<string | null>(null)
const leftPanel = ref<InstanceType<typeof LeftPanel> | null>(null)
const rightPanel = ref<InstanceType<typeof RightPanel> | null>(null)
const shell = ref<HTMLElement | null>(null)
const { leftStyle, leftPercent, dragging, onPointerDown, onKeydown } = useResizableSplit(shell)
// Boot splash: shown from first paint, dismissed once startup work settles below.
const { visible: splashVisible, ready: splashReady } = useSplash()
const modal = ref<'about' | 'app-config' | 'prompt-config' | null>(null)
const confirmReset = ref(false)
const orchestratorAsk = ref<{ key: string; summary: string } | null>(null)
let offMenu: (() => void) | null = null
let offDeepLink: (() => void) | null = null
let offOrchestrate: (() => void) | null = null

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
  leftPanel.value?.closeAll()
  activeTicketKey.value = null
  confirmReset.value = false
}

const orchestratorMessage = computed(() => {
  if (!orchestratorAsk.value) return ''
  const { key, summary } = orchestratorAsk.value
  return `Run Jira Orchestrator on ${key}${summary ? ` — "${summary}"` : ''}? It will pick a playbook and run it autonomously.`
})

async function requestOrchestrator(key: string): Promise<void> {
  const r = await window.api.getTicket(key)
  const summary = r.ok ? r.ticket.summary : ''
  orchestratorAsk.value = { key, summary }
}

function confirmOrchestrator(): void {
  if (!orchestratorAsk.value) return
  rightPanel.value?.startOrchestrator(orchestratorAsk.value.key)
  orchestratorAsk.value = null
}

async function handleDeepLink(link: DeepLink): Promise<void> {
  await leftPanel.value?.openTickets([link.ticket])
  activeTicketKey.value = link.ticket
  if (link.action === 'yolo') await requestOrchestrator(link.ticket)
}

// SeniorDevWatch (--orchestrate / warm ORCHESTRATOR.run): open the ticket and run
// the orchestrator directly — NO confirm gate (the trigger is a trusted local CLI
// arg, not a web deep link, and approval already happened in the watcher).
async function runOrchestratorNow(key: string): Promise<void> {
  await leftPanel.value?.openTickets([key])
  activeTicketKey.value = key
  rightPanel.value?.startOrchestrator(key)
}

onMounted(async () => {
  offMenu = window.api.onMenuAction(onMenu)
  offDeepLink = window.api.onDeepLink(handleDeepLink)
  offOrchestrate = window.api.onOrchestrate(runOrchestratorNow)
  // Only now can main push deep links — anything sent earlier would be lost.
  window.api.deepLinkReady()
  try {
    const startup = await window.api.getStartup()
    if (startup.tickets.length) {
      await leftPanel.value?.openTickets(startup.tickets)
      activeTicketKey.value = startup.tickets[0]
    }
    if (startup.session) rightPanel.value?.startStartupSession(startup.session)
    if (startup.deeplink) await requestOrchestrator(startup.deeplink.ticket)
    if (startup.orchestrate) await runOrchestratorNow(startup.orchestrate)
  } catch (err) {
    // Startup is best-effort: fall back to an empty workbench the user drives manually.
    console.error('Startup load failed:', err)
  } finally {
    // The app is now as ready as it gets (tickets/session loaded, or startup
    // failed and we're falling back) — take the splash down. Fires on both the
    // success and error paths so the splash can never outlive startup.
    splashReady()
  }
})

onBeforeUnmount(() => {
  offMenu?.()
  offDeepLink?.()
  offOrchestrate?.()
})
</script>

<template>
  <div ref="shell" class="shell" :class="{ 'shell--dragging': dragging }">
    <LeftPanel ref="leftPanel" :style="leftStyle" @active-ticket="activeTicketKey = $event" />
    <div
      class="divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panels"
      tabindex="0"
      :aria-valuenow="leftPercent"
      aria-valuemin="0"
      aria-valuemax="100"
      @pointerdown="onPointerDown"
      @keydown="onKeydown"
    ></div>
    <RightPanel ref="rightPanel" :active-ticket-key="activeTicketKey" :style="{ flex: '1 1 0' }" />
  </div>
  <AboutModal v-if="modal === 'about'" @close="modal = null" />
  <AppConfigModal v-if="modal === 'app-config'" @close="modal = null" />
  <PromptConfigModal v-if="modal === 'prompt-config'" @close="modal = null" />
  <ConfirmDialog
    v-if="confirmReset"
    title="New Session"
    message="Close all tickets and sessions? Running sessions will be killed."
    confirm-label="Close all"
    @confirm="doReset"
    @cancel="confirmReset = false"
  />
  <ConfirmDialog
    v-if="orchestratorAsk !== null"
    title="Jira Orchestrator"
    :message="orchestratorMessage"
    confirm-label="Run"
    @confirm="confirmOrchestrator"
    @cancel="orchestratorAsk = null"
  />
  <Transition name="splash-fade">
    <Splash v-if="splashVisible" />
  </Transition>
</template>
