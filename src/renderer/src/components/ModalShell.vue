<!-- src/renderer/src/components/ModalShell.vue -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { isTopModal, popModal, pushModal } from '../modal-stack'
defineProps<{ title: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()
let stackToken: symbol | null = null
function onKey(e: KeyboardEvent): void {
  // Only the topmost shell answers Escape — a stacked ConfirmDialog must not
  // drag its parent modal down with it.
  if (e.key === 'Escape' && stackToken !== null && isTopModal(stackToken)) emit('close')
}
onMounted(() => {
  stackToken = pushModal()
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  if (stackToken !== null) popModal(stackToken)
})
</script>

<template>
  <div class="modal-overlay" @pointerdown.self="emit('close')">
    <div class="modal" role="dialog" aria-modal="true" :aria-label="title">
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
  background: oklch(0 0 0 / 0.5);
}
.modal {
  display: flex; flex-direction: column; min-width: 420px; max-width: min(860px, 92vw);
  max-height: 88vh; background: var(--surface-2); color: var(--ink);
  border: 1px solid var(--hairline-strong); border-radius: var(--radius-sm);
  box-shadow: 0 20px 60px oklch(0 0 0 / 0.45);
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
