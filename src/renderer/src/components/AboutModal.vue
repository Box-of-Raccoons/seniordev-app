<!-- src/renderer/src/components/AboutModal.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import ModalShell from './ModalShell.vue'
import mascotUrl from '../assets/mascot.png'
import type { AppInfo } from '../../../shared/ipc'
const emit = defineEmits<{ (e: 'close'): void }>()
const info = ref<AppInfo | null>(null)
// Same build-time year as the boot splash, so the two credit lines never drift.
const buildYear = __BUILD_YEAR__
onMounted(async () => {
  try { info.value = await window.api.getAppInfo() } catch { info.value = { name: 'SeniorDev', version: '?' } }
})
</script>

<template>
  <ModalShell title="About SeniorDev" @close="emit('close')">
    <div class="about">
      <div class="about__text">
        <p class="about__name">{{ info?.name ?? '…' }}</p>
        <p class="about__version">v{{ info?.version ?? '…' }}</p>
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
.about__credit { color: var(--ink-muted); font-size: 12px; margin: 0; }
.about-ok {
  background: var(--teal); color: var(--bg); border: 0;
  border-radius: var(--radius-sm); padding: 6px 18px; cursor: pointer; font-weight: 600;
}
</style>
