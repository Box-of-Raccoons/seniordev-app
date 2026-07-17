<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const emit = defineEmits<{ (e: 'pick', payload: { variant: 'agent' | 'terminal'; tool?: string }): void }>()

const open = ref(false)
const tools = ref<string[]>([])
const wrap = ref<HTMLElement | null>(null)
let offConfig: (() => void) | null = null

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

async function refetch(): Promise<void> {
  try {
    tools.value = await window.api.listTools()
  } catch {
    tools.value = []
  }
}

function onPointerDown(e: PointerEvent): void {
  if (open.value && wrap.value && !wrap.value.contains(e.target as Node)) open.value = false
}
function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') open.value = false
}

onMounted(async () => {
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

function pickTool(tool: string): void {
  open.value = false
  emit('pick', { variant: 'agent', tool })
}
function pickTerminal(): void {
  open.value = false
  emit('pick', { variant: 'terminal' })
}
</script>

<template>
  <div ref="wrap" class="newtab">
    <button class="new-session" aria-haspopup="menu" :aria-expanded="open" aria-label="New session" title="New session" @click="open = !open">+</button>
    <div v-if="open" class="menu" role="menu">
      <button v-for="t in tools" :key="t" class="menu-item" role="menuitem" @click="pickTool(t)">{{ cap(t) }}</button>
      <div class="sep" role="separator"></div>
      <button class="menu-item" role="menuitem" @click="pickTerminal">Terminal</button>
    </div>
  </div>
</template>

<style scoped>
.newtab { position: relative; }
.new-session {
  background: var(--teal); color: var(--bg); border: 0;
  border-radius: var(--radius-sm); padding: 4px 12px; cursor: pointer; font-weight: 600; font-size: 16px; line-height: 1.2;
}
.new-session:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.menu {
  position: absolute; right: 0; top: calc(100% + 4px); z-index: 20; min-width: 160px;
  background: var(--surface-2); border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-sm); padding: 4px; display: flex; flex-direction: column; gap: 2px;
  box-shadow: var(--shadow-popover);
}
.menu-item {
  background: transparent; color: var(--ink); border: 0; border-radius: var(--radius-sm);
  padding: 7px 10px; cursor: pointer; text-align: left; width: 100%; font: inherit;
}
.menu-item:hover { background: var(--surface); }
.menu-item:focus-visible { outline: 2px solid var(--ink); outline-offset: -2px; }
.sep { height: 1px; background: var(--hairline); margin: 3px 4px; }
</style>
