<!-- src/renderer/src/components/AboutModal.vue -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ModalShell from './ModalShell.vue'
import mascotUrl from '../assets/mascot.png'
import type { AppInfo, UpdateInfo } from '../../../shared/ipc'
const emit = defineEmits<{ (e: 'close'): void; (e: 'install'): void }>()
const info = ref<AppInfo | null>(null)
const update = ref<UpdateInfo | null>(null)
let offUpdate: (() => void) | null = null
// Same build-time year as the boot splash, so the two credit lines never drift.
const buildYear = __BUILD_YEAR__
onMounted(async () => {
  try { info.value = await window.api.getAppInfo() } catch { info.value = { name: 'SeniorDev', version: '?' } }
  try { update.value = await window.api.getUpdateStatus() } catch { update.value = null }
  // Progress arrives while the modal is open, so follow the live status too.
  offUpdate = window.api.onUpdateStatus((e) => { update.value = e })
})
onBeforeUnmount(() => offUpdate?.())

// One sentence per state. The text carries the state on its own — the error tint
// is redundant emphasis, never the signal itself (DESIGN.md: never color alone).
const updateText = computed(() => {
  const u = update.value
  if (!u) return ''
  if (!u.supported) return 'Updates arrive in installed builds; this one runs from source.'
  switch (u.state) {
    case 'checking': return 'Checking for updates…'
    case 'downloading': return `Downloading v${u.version}… ${u.percent ?? 0}%`
    case 'ready': return `v${u.version} is ready. It installs when you quit SeniorDev.`
    case 'error': return `Update check failed: ${u.message}`
    default: return 'SeniorDev is up to date.'
  }
})
const isReady = computed(() => update.value?.state === 'ready')
const canCheck = computed(() => {
  const u = update.value
  if (!u?.supported || isReady.value) return false
  return u.state !== 'checking' && u.state !== 'downloading'
})
async function check(): Promise<void> {
  try { update.value = await window.api.checkForUpdate() } catch { /* the error event reports it */ }
}
</script>

<template>
  <ModalShell title="About SeniorDev" @close="emit('close')">
    <div class="about">
      <div class="about__text">
        <p class="about__name">{{ info?.name ?? '…' }}</p>
        <p class="about__version">v{{ info?.version ?? '…' }}</p>
        <p v-if="updateText" class="about__update" :class="{ 'about__update--error': update?.state === 'error' }">
          {{ updateText }}
        </p>
        <div v-if="canCheck || isReady" class="about__actions">
          <button v-if="canCheck" class="about-secondary" @click="check">Check for updates</button>
          <button v-if="isReady" class="about-secondary" @click="emit('install')">Restart and install now</button>
        </div>
        <p class="about__credit">By Box of Raccoons LLC, {{ buildYear }}</p>
      </div>
      <img class="about__mascot" :src="mascotUrl" alt="Box of Raccoons mascot" />
    </div>
    <template #footer>
      <button class="about-ok" @click="emit('close')">OK</button>
    </template>
  </ModalShell>
</template>

<style scoped>
.about { display: flex; align-items: center; gap: 20px; text-align: left; padding: 8px 24px; }
.about__text { flex: 1; }
.about__mascot { width: 160px; height: auto; display: block; border-radius: var(--radius-sm); }
.about__name { font-size: 18px; font-weight: 700; margin: 0 0 4px; }
.about__version { color: var(--ink-soft); margin: 0 0 12px; }
.about__update { color: var(--ink-soft); font-size: 13px; margin: 0 0 8px; }
.about__update--error { color: var(--rust); }
.about__actions { display: flex; gap: 8px; margin: 0 0 12px; }
.about__credit { color: var(--ink-muted); font-size: 12px; margin: 0; }
/* Secondary weight on purpose: teal marks the one primary action on a surface,
   which here is the footer's OK. */
.about-secondary {
  background: var(--surface); color: var(--ink); border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-sm); padding: 5px 12px; cursor: pointer; font-size: 13px;
}
.about-secondary:hover { border-color: var(--teal); }
.about-secondary:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; }
.about-ok {
  background: var(--teal); color: var(--bg); border: 0;
  border-radius: var(--radius-sm); padding: 6px 18px; cursor: pointer; font-weight: 600;
}
</style>
