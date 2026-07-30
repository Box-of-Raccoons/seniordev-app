<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

// `mode` rides only on the 'Open' pick: it seeds the composer straight into Open
// (unprompted) mode. 'AI' leaves it undefined (composer defaults to Task).
const emit = defineEmits<{ (e: 'pick', payload: { variant: 'agent' | 'terminal'; mode?: 'task' | 'open'; tool?: string }): void }>()
// `ghost` (S6): a muted trigger for the per-project launcher in the sidebar, so it
// does not spend teal (One Signal Rule reserves teal for the composer's Launch).
// `label` overrides the trigger glyph/text (e.g. a "New Project" button).
// `tools` (S6): the detected agent CLIs. With more than one, Open expands to a
// submenu so the instant launch can pick which agent (AI defers this to the
// composer's own tool picker, so it stays a single item).
const props = defineProps<{ ghost?: boolean; label?: string; tools?: string[] }>()

const open = ref(false)
const wrap = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const trigger = ref<HTMLElement | null>(null)
// The menu is position:fixed, anchored to the trigger's viewport rect, so it is not
// clipped by an ancestor's overflow (the sidebar's .sb-scroll clips absolutely-
// positioned children). Coords are computed on open.
const pos = ref<{ top: number; left: number }>({ top: 0, left: 0 })
const MENU_W = 160

// Place the fixed menu just below the trigger, clamped into the viewport so it never
// spills off the right or bottom edge.
function place(): void {
  const r = trigger.value?.getBoundingClientRect()
  if (!r) return
  const left = Math.max(4, Math.min(r.left, window.innerWidth - MENU_W - 4))
  const top = Math.min(r.bottom + 4, window.innerHeight - 8)
  pos.value = { top, left }
}

async function openPanel(): Promise<void> {
  place()
  open.value = true
  // Move focus into the menu on open so it is keyboard-operable (role="menu").
  await nextTick()
  items()[0]?.focus()
}

async function toggle(): Promise<void> {
  if (open.value) {
    open.value = false
    return
  }
  await openPanel()
}

// S6: open the menu programmatically (New Project pops the new row's menu). Exposed
// so a parent can call it via a template ref.
async function openMenu(): Promise<void> {
  await openPanel()
}
defineExpose({ openMenu })

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

function onPointerDown(e: PointerEvent): void {
  if (open.value && wrap.value && !wrap.value.contains(e.target as Node)) open.value = false
}
function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown)
  document.addEventListener('keydown', onKeyDown)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown)
  document.removeEventListener('keydown', onKeyDown)
})

// More than one detected agent → Open expands to a per-agent submenu.
const openSubOpen = ref(false)
const multiTool = (): boolean => (props.tools?.length ?? 0) > 1
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
function closeAll(): void {
  open.value = false
  openSubOpen.value = false
}

// The menu only picks the KIND of session — an AI agent or a raw shell. Which
// agent CLI (Claude, Codex, …) is chosen later, in the composer's tool picker.
function pickAgent(): void {
  closeAll()
  emit('pick', { variant: 'agent' })
}
// A bare agent, unprompted, in the project — the fast path. With one tool it fires
// directly; with several, toggle the submenu to pick which agent.
function pickOpen(): void {
  if (multiTool()) {
    openSubOpen.value = !openSubOpen.value
    return
  }
  closeAll()
  emit('pick', { variant: 'agent', mode: 'open' })
}
function pickOpenWith(tool: string): void {
  closeAll()
  emit('pick', { variant: 'agent', mode: 'open', tool })
}
function pickTerminal(): void {
  closeAll()
  emit('pick', { variant: 'terminal' })
}
</script>

<template>
  <div ref="wrap" class="newtab">
    <button
      ref="trigger"
      class="new-session"
      :class="{ 'new-session--ghost': props.ghost }"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-label="props.label ?? 'New session'"
      :title="props.label ?? 'New session'"
      @click="toggle"
    >{{ props.label ?? '+' }}</button>
    <div
      v-if="open"
      ref="menu"
      class="menu"
      role="menu"
      :style="{ top: pos.top + 'px', left: pos.left + 'px' }"
      @keydown="onMenuKeydown"
    >
      <button
        class="menu-item"
        :class="{ 'menu-item--parent': multiTool() }"
        role="menuitem"
        :aria-haspopup="multiTool() ? 'menu' : undefined"
        :aria-expanded="multiTool() ? openSubOpen : undefined"
        @click="pickOpen"
      >New Session<span v-if="multiTool()" class="caret" aria-hidden="true">▸</span></button>
      <div v-if="multiTool() && openSubOpen" class="submenu" role="menu">
        <button
          v-for="t in props.tools"
          :key="t"
          class="menu-item menu-item--sub"
          role="menuitem"
          @click="pickOpenWith(t)"
        >{{ cap(t) }}</button>
      </div>
      <button class="menu-item" role="menuitem" @click="pickAgent">AI Task</button>
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
/* Ghost trigger (S6 sidebar launchers): muted, no teal, so it reads as secondary
   next to a project name and never competes with the composer's one teal action. */
.new-session--ghost {
  background: transparent; color: var(--ink-muted); font-weight: 600;
  padding: 2px 8px; font-size: 15px;
}
.new-session--ghost:hover { color: var(--ink); background: var(--surface); }
.new-session--ghost:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; }
.menu {
  /* Fixed + viewport-anchored (coords set inline), so the sidebar's overflow does
     not clip it. z-index above the app chrome. */
  position: fixed; z-index: 200; min-width: 160px;
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
/* Open submenu parent: a caret pushed to the right edge. */
.menu-item--parent { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.caret { color: var(--ink-muted); font-size: 11px; }
/* Nested agent choices under New Session, indented a step. */
.submenu { display: flex; flex-direction: column; gap: 2px; }
.menu-item--sub { padding-left: 22px; color: var(--ink-soft); }
.menu-item--sub:hover { color: var(--ink); }
.sep { height: 1px; background: var(--hairline); margin: 3px 4px; }
</style>
