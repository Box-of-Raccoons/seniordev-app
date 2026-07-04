<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { PromptSummary } from '../../../shared/ipc'

const emit = defineEmits<{ (e: 'start', payload: { prompt?: { name?: string; text?: string }; yolo: boolean }): void }>()

const open = ref(false)
const prompts = ref<PromptSummary[]>([])
const customOpen = ref(false)
const customText = ref('')
const mode = ref<'interactive' | 'yolo'>('interactive')
const yoloAvailable = ref(false)
const menuWrap = ref<HTMLElement | null>(null)
let offConfig: (() => void) | null = null

async function refetch(): Promise<void> {
  try { prompts.value = await window.api.listPrompts() } catch { prompts.value = [] }
  try { yoloAvailable.value = (await window.api.yoloCaps()).available } catch { yoloAvailable.value = false }
}

function onPointerDown(e: PointerEvent): void {
  if (open.value && menuWrap.value && !menuWrap.value.contains(e.target as Node)) {
    open.value = false
    customOpen.value = false
  }
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    open.value = false
    customOpen.value = false
  }
}

onMounted(async () => {
  // Register synchronously — if this ran after the await, an unmount during the
  // listPrompts round-trip would leak listeners onBeforeUnmount can't see yet.
  document.addEventListener('pointerdown', onPointerDown)
  document.addEventListener('keydown', onKeyDown)
  offConfig = window.api.onConfigChanged(() => void refetch())
  await refetch()
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown)
  document.removeEventListener('keydown', onKeyDown)
  offConfig?.()
})

function choose(payload: { prompt?: { name?: string; text?: string } }): void {
  open.value = false
  customOpen.value = false
  const yolo = mode.value === 'yolo'
  customText.value = ''
  emit('start', { ...payload, yolo })
}
</script>

<template>
  <div ref="menuWrap" class="menu-wrap">
    <button class="new-session" @click="open = !open">+ New session ▾</button>
    <div v-if="open" class="menu">
      <div class="mode-toggle" role="group" aria-label="Session mode">
        <button type="button" :class="{ 'mode--on': mode === 'interactive' }" @click="mode = 'interactive'">Interactive</button>
        <button
          type="button"
          :class="{ 'mode--on': mode === 'yolo' }"
          :disabled="!yoloAvailable"
          :title="yoloAvailable ? '' : 'Default tool has no headless config'"
          @click="mode = 'yolo'"
        >YOLO ⚡</button>
      </div>
      <button v-if="mode === 'interactive'" class="menu-item" @click="choose({})">Interactive (no prompt)</button>
      <button
        v-for="p in prompts"
        :key="p.name"
        class="menu-item"
        @click="choose({ prompt: { name: p.name } })"
      >
        <span class="menu-item__name">{{ p.name }}</span>
        <span v-if="p.description" class="menu-item__desc">{{ p.description }}</span>
      </button>
      <button class="menu-item" @click="customOpen = !customOpen">Custom prompt…</button>
      <form v-if="customOpen" class="custom" @submit.prevent="choose({ prompt: { text: customText } })">
        <textarea v-model="customText" rows="3" aria-label="First prompt" placeholder="Type a first prompt…"></textarea>
        <button class="custom__go" type="submit" :disabled="!customText.trim()">Start</button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.menu-wrap { position: relative; }
.new-session {
  background: var(--teal); color: var(--bg); border: 0;
  border-radius: var(--radius-sm); padding: 6px 12px; cursor: pointer; font-weight: 600; white-space: nowrap;
}
.new-session:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.menu {
  position: absolute; right: 0; top: calc(100% + 4px); z-index: 20;
  min-width: 240px; background: var(--surface-2); border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-sm); padding: 4px; display: flex; flex-direction: column; gap: 2px;
  box-shadow: var(--shadow-popover);
}
.menu-item {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  background: transparent; color: var(--ink); border: 0; border-radius: var(--radius-sm);
  padding: 7px 10px; cursor: pointer; text-align: left; width: 100%;
}
.menu-item:hover { background: var(--surface); }
.menu-item:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.menu-item__desc { color: var(--ink-muted); font-size: 12px; }
.custom { display: flex; flex-direction: column; gap: 6px; padding: 6px; }
.custom textarea {
  background: var(--surface); color: var(--ink); border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-sm); padding: 6px; resize: vertical; font-family: inherit;
}
.custom textarea::placeholder { color: var(--ink-muted); }
.custom textarea:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; border-color: transparent; }
.custom__go {
  align-self: flex-end; background: var(--teal); color: var(--bg); border: 0;
  border-radius: var(--radius-sm); padding: 5px 12px; cursor: pointer; font-weight: 600;
}
.custom__go:disabled { opacity: 0.5; cursor: default; }
.mode-toggle { display: flex; gap: 2px; padding: 2px; margin-bottom: 4px; background: var(--surface); border-radius: var(--radius-sm); }
.mode-toggle button {
  flex: 1; background: transparent; color: var(--ink-muted); border: 0;
  border-radius: var(--radius-sm); padding: 5px 8px; cursor: pointer; font-weight: 600; font-size: 12px;
}
.mode-toggle button.mode--on { background: var(--surface-2); color: var(--ink); }
.mode-toggle button:disabled { opacity: 0.4; cursor: default; }
.mode-toggle button:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; }
</style>
