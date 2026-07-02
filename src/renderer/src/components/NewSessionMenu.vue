<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { PromptSummary } from '../../../shared/ipc'

const emit = defineEmits<{ (e: 'start', payload: { prompt?: { name?: string; text?: string } }): void }>()

const open = ref(false)
const prompts = ref<PromptSummary[]>([])
const customOpen = ref(false)
const customText = ref('')

onMounted(async () => {
  try { prompts.value = await window.api.listPrompts() } catch { prompts.value = [] }
})

function choose(payload: { prompt?: { name?: string; text?: string } }): void {
  open.value = false
  customOpen.value = false
  customText.value = ''
  emit('start', payload)
}
</script>

<template>
  <div class="menu-wrap">
    <button class="new-session" @click="open = !open">+ New session ▾</button>
    <div v-if="open" class="menu">
      <button class="menu-item" @click="choose({})">Interactive (no prompt)</button>
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
        <textarea v-model="customText" rows="3" placeholder="Type a first prompt…"></textarea>
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
  box-shadow: 0 10px 30px oklch(0 0 0 / 0.35);
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
</style>
