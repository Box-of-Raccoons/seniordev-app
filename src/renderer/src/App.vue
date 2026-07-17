<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import RightPanel from './components/RightPanel.vue'
import AboutModal from './components/AboutModal.vue'
import AppConfigModal from './components/AppConfigModal.vue'
import PromptConfigModal from './components/PromptConfigModal.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import Splash from './components/Splash.vue'
import { useSplash } from './composables/useSplash'
import type { MenuAction, DeepLink, RepoResolution } from '../../shared/ipc'

const rightPanel = ref<InstanceType<typeof RightPanel> | null>(null)
// Boot splash: shown from first paint, dismissed once startup work settles below.
const { visible: splashVisible, ready: splashReady } = useSplash()
const modal = ref<'about' | 'app-config' | 'prompt-config' | null>(null)
const confirmReset = ref(false)
const orchestratorAsk = ref<{
  key: string
  summary: string
  fromDeepLink: boolean
  repo: RepoResolution
  blocked?: string
} | null>(null)
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
  rightPanel.value?.newTab()
  confirmReset.value = false
}

const orchestratorMessage = computed(() => {
  const a = orchestratorAsk.value
  if (!a) return ''
  if (a.blocked) return a.blocked
  // Provenance first: a YOLO run started by an external link must announce itself
  // so the developer never confirms one thinking they initiated it (SD-9 S2).
  const provenance = a.fromDeepLink ? '⚠ Triggered by an external link.\n\n' : ''
  const where = a.repo ? `\n\nTool: ${a.repo.tool} · Repo: ${a.repo.path}` : ''
  return `${provenance}Run Jira Orchestrator on ${a.key}${a.summary ? ` — "${a.summary}"` : ''}? It will pick a playbook and run it autonomously.${where}`
})

async function requestOrchestrator(key: string, fromDeepLink = false): Promise<void> {
  const r = await window.api.getTicket(key)
  const summary = r.ok ? r.ticket.summary : ''
  const repo = await window.api.resolveRepo(key)
  // Refuse a deep-link YOLO whose project maps to no configured repo — running it
  // would fall back to the home dir. Confirm or refuse with a reason, never
  // guess-and-run (SD-9 S2; design principle #2).
  if (fromDeepLink && !repo) {
    const project = key.split('-')[0]
    orchestratorAsk.value = {
      key, summary, fromDeepLink, repo: null,
      blocked: `No configured repo maps to project ${project}, so SeniorDev won't run an autonomous session for ${key} triggered by an external link. Add a repo for ${project} in config, then retry.`
    }
    return
  }
  orchestratorAsk.value = { key, summary, fromDeepLink, repo }
}

function confirmOrchestrator(): void {
  const a = orchestratorAsk.value
  if (!a || a.blocked) return
  rightPanel.value?.startOrchestrator(a.key)
  orchestratorAsk.value = null
}

async function handleDeepLink(link: DeepLink): Promise<void> {
  if (link.action === 'yolo') await requestOrchestrator(link.ticket, true)
  else rightPanel.value?.newTab()
}

// SeniorDevWatch (--orchestrate / warm ORCHESTRATOR.run): run the orchestrator
// directly — NO confirm gate (the trigger is a trusted local CLI arg, not a web
// deep link, and approval already happened in the watcher).
function runOrchestratorNow(key: string): void {
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
    if (startup.session) rightPanel.value?.startStartupSession(startup.session, startup.tickets[0])
    if (startup.deeplink) await requestOrchestrator(startup.deeplink.ticket, true)
    if (startup.orchestrate) runOrchestratorNow(startup.orchestrate)
  } catch (err) {
    // Startup is best-effort: fall back to a fresh composer the user drives.
    console.error('Startup load failed:', err)
  } finally {
    // Always land on a launch surface: if nothing above opened a session, open a
    // composer tab so the app never boots into an empty room.
    if (!rightPanel.value?.hasSessions()) rightPanel.value?.newTab()
    // The app is now as ready as it gets — take the splash down (both paths).
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
  <div class="shell">
    <RightPanel ref="rightPanel" />
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
    :title="orchestratorAsk.blocked ? 'YOLO refused' : 'Jira Orchestrator'"
    :message="orchestratorMessage"
    :hide-confirm="!!orchestratorAsk.blocked"
    confirm-label="Run"
    @confirm="confirmOrchestrator"
    @cancel="orchestratorAsk = null"
  />
  <Transition name="splash-fade">
    <Splash v-if="splashVisible" />
  </Transition>
</template>
