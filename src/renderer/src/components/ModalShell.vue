<!-- src/renderer/src/components/ModalShell.vue -->
<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { isTopModal, popModal, pushModal } from '../modal-stack'
defineProps<{ title: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()
let stackToken: symbol | null = null
const dialogEl = ref<HTMLElement | null>(null)
// The element focus should return to when this modal closes (usually the
// control that opened it) — captured on mount, restored on unmount.
let previouslyFocused: HTMLElement | null = null

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusables(): HTMLElement[] {
  if (!dialogEl.value) return []
  return Array.from(dialogEl.value.querySelectorAll<HTMLElement>(FOCUSABLE))
}

function onKey(e: KeyboardEvent): void {
  // Only the topmost shell responds — a stacked ConfirmDialog must not drag its
  // parent modal down, and only the top dialog owns the focus trap.
  if (stackToken === null || !isTopModal(stackToken)) return
  if (e.key === 'Escape') {
    emit('close')
    return
  }
  if (e.key !== 'Tab') return
  // Focus trap: keep Tab / Shift+Tab cycling inside the dialog.
  const els = focusables()
  const active = document.activeElement as HTMLElement | null
  if (els.length === 0) {
    e.preventDefault()
    dialogEl.value?.focus()
    return
  }
  const first = els[0]
  const last = els[els.length - 1]
  if (!dialogEl.value?.contains(active)) {
    e.preventDefault()
    first.focus()
  } else if (e.shiftKey && active === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}

onMounted(async () => {
  stackToken = pushModal()
  previouslyFocused = document.activeElement as HTMLElement | null
  document.addEventListener('keydown', onKey)
  // Move focus into the dialog so keyboard users aren't stranded behind the
  // scrim; fall back to the dialog container when it has no focusable content.
  await nextTick()
  ;(focusables()[0] ?? dialogEl.value)?.focus()
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  if (stackToken !== null) popModal(stackToken)
  if (previouslyFocused?.isConnected) previouslyFocused.focus()
})
</script>

<template>
  <div class="modal-overlay" @pointerdown.self="emit('close')">
    <div ref="dialogEl" class="modal" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1">
      <header class="modal__head">
        <h2>{{ title }}</h2>
        <button class="modal__x" aria-label="Close" @click="emit('close')">×</button>
      </header>
      <div class="modal__body"><slot /></div>
      <footer v-if="$slots.footer" class="modal__foot"><slot name="footer" /></footer>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0; z-index: 100; display: grid; place-items: center;
  padding: 16px; background: var(--scrim);
}
.modal {
  display: flex; flex-direction: column;
  /* min() so the dialog never exceeds a narrow window (min-width would overflow) */
  min-width: min(420px, 100%); max-width: min(860px, 92vw);
  max-height: 88vh; background: var(--surface-2); color: var(--ink);
  border: 1px solid var(--hairline-strong); border-radius: var(--radius-sm);
  box-shadow: var(--shadow-overlay);
}
.modal__head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid var(--hairline);
}
.modal__head h2 { margin: 0; font-size: 15px; }
.modal__x { background: transparent; border: 0; color: var(--ink-muted); font-size: 18px; cursor: pointer; }
.modal__x:hover { color: var(--ink); }
.modal__body { padding: 14px 16px; overflow: auto; flex: 1; min-height: 0; }
.modal__foot { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--hairline); }
</style>
