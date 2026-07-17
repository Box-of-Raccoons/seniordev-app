<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const emit = defineEmits<{ (e: 'pick', payload: { variant: 'agent' | 'terminal'; tool?: string }): void }>()

const open = ref(false)
const tools = ref<string[]>([])
const wrap = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)
let offConfig: (() => void) | null = null

async function toggle(): Promise<void> {
  open.value = !open.value
  // Move focus into the menu on open so it is keyboard-operable (role="menu").
  if (open.value) {
    await nextTick()
    items()[0]?.focus()
  }
}

function items(): HTMLButtonElement[] {
  return menu.value ? Array.from(menu.value.querySelectorAll<HTMLButtonElement>('.menu-item')) : []
}

// Arrow / Home / End move focus between items, matching the menu role's contract.
function onMenuKeydown(e: KeyboardEvent): void {
  const list = items()
  const i = list.indexOf(document.activeElement as HTMLButtonElement)
  if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus() }
  else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus() }
  else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus() }
  else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus() }
}

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
    <button class="new-session" aria-haspopup="menu" :aria-expanded="open" aria-label="New session" title="New session" @click="toggle">+</button>
    <div v-if="open" ref="menu" class="menu" role="menu" @keydown="onMenuKeydown">
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
