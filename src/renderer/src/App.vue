<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import LeftPanel from './components/LeftPanel.vue'
import RightPanel from './components/RightPanel.vue'
import AboutModal from './components/AboutModal.vue'
import AppConfigModal from './components/AppConfigModal.vue'
import PromptConfigModal from './components/PromptConfigModal.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import type { MenuAction, DeepLink } from '../../shared/ipc'

const activeTicketKey = ref<string | null>(null)
const leftPanel = ref<InstanceType<typeof LeftPanel> | null>(null)
const rightPanel = ref<InstanceType<typeof RightPanel> | null>(null)
const modal = ref<'about' | 'app-config' | 'prompt-config' | null>(null)
const confirmReset = ref(false)
const orchestratorAsk = ref<{ key: string; summary: string } | null>(null)
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

onMounted(async () => {
  offMenu = window.api.onMenuAction(onMenu)
  offDeepLink = window.api.onDeepLink(handleDeepLink)
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
  } catch (err) {
    // Startup is best-effort: fall back to an empty workbench the user drives manually.
    console.error('Startup load failed:', err)
  }
})

onBeforeUnmount(() => {
  offMenu?.()
  offDeepLink?.()
})
</script>

<template>
  <div class="shell">
    <LeftPanel ref="leftPanel" @active-ticket="activeTicketKey = $event" />
    <RightPanel ref="rightPanel" :active-ticket-key="activeTicketKey" />
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
</template>
