<script setup lang="ts">
import { ref } from 'vue'
import ModalShell from './ModalShell.vue'

// S5 teardown confirm (spec section 9). Archiving a conversation is the primary
// action (reversible, data kept per spec 4.6); when the conversation ran in a
// worktree, an opt-in checkbox offers to remove it too. Removal is never forced —
// a dirty worktree is refused by git and the reason is reported here, with the
// archive still applied. Reuses ModalShell (Escape/focus-trap/scrim).
const props = defineProps<{
  title: string
  // The worktree path to offer removal of; null/undefined ⇒ no worktree, no checkbox.
  worktreePath?: string | null
  // A removal-failure message to report after a confirm (kept open to show it).
  failure?: string | null
}>()
const emit = defineEmits<{
  (e: 'confirm', payload: { removeWorktree: boolean; dontAskAgain: boolean }): void
  (e: 'cancel'): void
}>()

const removeWorktree = ref(false) // default OFF — never destroy a diff by default
// S7: only offered for a no-worktree archive; worktree teardowns always confirm.
const dontAskAgain = ref(false)
</script>

<template>
  <ModalShell :title="title" @close="emit('cancel')">
    <p class="msg">This archives the conversation. Its history is kept and it can be restored.</p>
    <label v-if="props.worktreePath" class="wt-remove">
      <input v-model="removeWorktree" type="checkbox" />
      <span class="wt-remove__text">
        also remove its worktree
        <span class="wt-remove__path">{{ props.worktreePath }}</span>
      </span>
    </label>
    <!-- Only for a no-worktree archive: suppress this confirm in future. A worktree
         teardown always confirms (removal is a real, destructive choice). -->
    <label v-if="!props.worktreePath" class="dont-ask">
      <input v-model="dontAskAgain" type="checkbox" />
      <span>Don't ask again</span>
    </label>
    <p v-if="props.failure" class="fail" role="alert">Worktree not removed: {{ props.failure }}</p>
    <template #footer>
      <button class="btn-no" @click="emit('cancel')">{{ props.failure ? 'Close' : 'Cancel' }}</button>
      <button class="btn-yes" @click="emit('confirm', { removeWorktree, dontAskAgain })">Archive</button>
    </template>
  </ModalShell>
</template>

<style scoped>
.msg { margin: 0 0 10px; }
.wt-remove { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; user-select: none; }
.wt-remove input { accent-color: var(--rust); margin-top: 2px; }
.wt-remove__text { font-size: 13px; color: var(--ink-soft); }
.wt-remove__path {
  display: block; font-family: var(--font-mono, Consolas, monospace); font-size: 11px;
  color: var(--ink-muted); margin-top: 2px; word-break: break-all;
}
.dont-ask { display: flex; align-items: center; gap: 8px; margin-top: 12px; cursor: pointer; user-select: none; font-size: 13px; color: var(--ink-soft); }
.dont-ask input { accent-color: var(--tan); }
/* State carried by text + rust colour together (DESIGN Color-Is-State). */
.fail { margin: 10px 0 0; color: var(--rust); font-size: 12.5px; }
.btn-no {
  background: var(--surface); color: var(--ink); border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-sm); padding: 6px 14px; cursor: pointer;
}
.btn-no:hover { color: var(--ink); }
.btn-no:focus-visible, .btn-yes:focus-visible { outline: 2px solid var(--teal); outline-offset: 2px; }
.btn-yes {
  background: var(--rust); color: var(--bg); border: 0;
  border-radius: var(--radius-sm); padding: 6px 14px; cursor: pointer; font-weight: 600;
}
</style>
