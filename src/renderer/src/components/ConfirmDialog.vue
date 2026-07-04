<!-- src/renderer/src/components/ConfirmDialog.vue -->
<script setup lang="ts">
import ModalShell from './ModalShell.vue'
// hideConfirm: a notice/refusal with no affirmative action — only a Close button.
withDefaults(defineProps<{ title: string; message: string; confirmLabel?: string; hideConfirm?: boolean }>(), { confirmLabel: 'Confirm', hideConfirm: false })
const emit = defineEmits<{ (e: 'confirm'): void; (e: 'cancel'): void }>()
</script>

<template>
  <ModalShell :title="title" @close="emit('cancel')">
    <p class="confirm__msg">{{ message }}</p>
    <template #footer>
      <button class="confirm-no" @click="emit('cancel')">{{ hideConfirm ? 'Close' : 'Cancel' }}</button>
      <button v-if="!hideConfirm" class="confirm-yes" @click="emit('confirm')">{{ confirmLabel }}</button>
    </template>
  </ModalShell>
</template>

<style scoped>
.confirm__msg { margin: 0; }
.confirm-no {
  background: var(--surface); color: var(--ink); border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-sm); padding: 6px 14px; cursor: pointer;
}
.confirm-yes {
  background: var(--rust, #b3552e); color: var(--bg); border: 0;
  border-radius: var(--radius-sm); padding: 6px 14px; cursor: pointer; font-weight: 600;
}
</style>
