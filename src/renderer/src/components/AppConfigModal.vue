<!-- src/renderer/src/components/AppConfigModal.vue -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import ModalShell from './ModalShell.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { TERM_FONT_FAMILY, TERM_FONT_SIZE } from '../term-style'

const emit = defineEmits<{ (e: 'close'): void }>()
const text = ref('')
const original = ref('')
const path = ref('')
const isTemplate = ref(false)
const error = ref<string | null>(null)
const confirmDiscard = ref(false)
const loaded = ref(false)
const saving = ref(false)
const dirty = computed(() => text.value !== original.value)

onMounted(async () => {
  const res = await window.api.readConfig()
  if (res.ok) {
    text.value = res.text
    original.value = res.text
    path.value = res.path
    isTemplate.value = res.isTemplate === true
    loaded.value = true
  } else {
    // Save stays disabled: the main-side validator would reject '' anyway,
    // but there's nothing sensible to save when the read itself failed.
    error.value = res.error
  }
})

async function save(): Promise<void> {
  if (!loaded.value || saving.value) return
  saving.value = true
  error.value = null
  try {
    const res = await window.api.saveConfig(text.value)
    if (res.ok) emit('close')
    else error.value = res.error
  } finally {
    saving.value = false
  }
}

function requestClose(): void {
  if (dirty.value) confirmDiscard.value = true
  else emit('close')
}
</script>

<template>
  <ModalShell title="App Config" @close="requestClose">
    <p class="cfg-path">{{ path }}</p>
    <p v-if="isTemplate" class="cfg-note">No config file exists yet — this is a starting template; Save creates it.</p>
    <textarea
      v-model="text"
      class="cfg-editor"
      aria-label="Config file contents"
      spellcheck="false"
      :style="{ fontFamily: TERM_FONT_FAMILY, fontSize: TERM_FONT_SIZE + 'px' }"
    ></textarea>
    <p v-if="error" class="cfg-error">{{ error }}</p>
    <template #footer>
      <button class="cfg-cancel" @click="requestClose">Cancel</button>
      <button class="cfg-save" :disabled="!loaded || saving" @click="save">{{ saving ? 'Saving…' : 'Save' }}</button>
    </template>
  </ModalShell>
  <ConfirmDialog
    v-if="confirmDiscard"
    title="Unsaved changes"
    message="Discard changes?"
    confirm-label="Discard"
    @confirm="confirmDiscard = false; emit('close')"
    @cancel="confirmDiscard = false"
  />
</template>

<style scoped>
.cfg-path { margin: 0 0 6px; color: var(--ink-muted); font-size: 12px; }
.cfg-note { margin: 0 0 8px; color: var(--ink-soft); font-size: 12px; }
.cfg-editor {
  width: 64vw; max-width: 100%; height: 52vh; resize: vertical;
  background: var(--surface); color: var(--ink);
  border: 1px solid var(--hairline-strong); border-radius: var(--radius-sm); padding: 10px;
  white-space: pre; overflow: auto;
}
.cfg-editor:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; border-color: transparent; }
.cfg-error {
  margin: 8px 0 0; padding: 8px 10px; font-size: 12px; white-space: pre-wrap;
  color: var(--ink); background: color-mix(in oklch, var(--rust, #b3552e) 18%, var(--surface));
  border: 1px solid color-mix(in oklch, var(--rust, #b3552e) 45%, var(--hairline-strong));
  border-radius: var(--radius-sm);
}
.cfg-cancel {
  background: var(--surface); color: var(--ink); border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-sm); padding: 6px 14px; cursor: pointer;
}
.cfg-save {
  background: var(--teal); color: var(--bg); border: 0;
  border-radius: var(--radius-sm); padding: 6px 18px; cursor: pointer; font-weight: 600;
}
</style>
