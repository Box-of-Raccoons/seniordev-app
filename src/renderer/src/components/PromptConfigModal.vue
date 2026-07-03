<!-- src/renderer/src/components/PromptConfigModal.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import ModalShell from './ModalShell.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { TERM_FONT_FAMILY, TERM_FONT_SIZE } from '../term-style'
import type { PromptSummary } from '../../../shared/ipc'

type Entry = { kind: 'context' } | { kind: 'preamble' } | { kind: 'recap' } | { kind: 'orchestrator' } | { kind: 'prompt'; name: string; description: string }

const emit = defineEmits<{ (e: 'close'): void }>()
const prompts = ref<PromptSummary[]>([])
const selected = ref<Entry | null>(null)
const text = ref('')
const original = ref('')
const error = ref<string | null>(null)
const recapDefault = ref(false)
const preambleDefault = ref(false)
const orchestratorDefault = ref(false)
const creating = ref(false)
const newName = ref('')
const confirmDelete = ref(false)
const pendingSelect = ref<Entry | null>(null)

async function refresh(): Promise<void> {
  try { prompts.value = await window.api.listPrompts() } catch { prompts.value = [] }
}

onMounted(refresh)

// Unsaved edits must not be silently discarded by clicking another list item —
// stash the target and ask first.
function requestSelect(entry: Entry): void {
  if (selected.value && text.value !== original.value) pendingSelect.value = entry
  else void select(entry)
}

async function confirmSwitch(): Promise<void> {
  const target = pendingSelect.value
  pendingSelect.value = null
  if (target) await select(target)
}

async function select(entry: Entry): Promise<void> {
  error.value = null
  if (entry.kind === 'context') {
    const res = await window.api.readContext()
    if (!res.ok) { error.value = res.error; return }
    text.value = res.text
  } else if (entry.kind === 'preamble') {
    const res = await window.api.readPreamble()
    text.value = res.text
    preambleDefault.value = res.isDefault
  } else if (entry.kind === 'recap') {
    const res = await window.api.readRecap()
    text.value = res.text
    recapDefault.value = res.isDefault
  } else if (entry.kind === 'orchestrator') {
    const res = await window.api.readOrchestratorPrompt()
    text.value = res.text
    orchestratorDefault.value = res.isDefault
  } else {
    const res = await window.api.readPrompt(entry.name)
    if (!res.ok) { error.value = res.error; return }
    text.value = res.text
  }
  original.value = text.value
  selected.value = entry
}

async function save(): Promise<void> {
  if (!selected.value) return
  error.value = null
  const s = selected.value
  const res =
    s.kind === 'context' ? await window.api.writeContext(text.value)
    : s.kind === 'preamble' ? await window.api.savePreamble(text.value)
    : s.kind === 'recap' ? await window.api.saveRecap(text.value)
    : s.kind === 'orchestrator' ? await window.api.saveOrchestratorPrompt(text.value)
    : await window.api.writePrompt(s.name, text.value)
  if (!res.ok) { error.value = res.error; return }
  original.value = text.value
  if (s.kind === 'preamble') preambleDefault.value = false
  if (s.kind === 'recap') recapDefault.value = false
  if (s.kind === 'orchestrator') orchestratorDefault.value = false
  await refresh()
}

async function create(): Promise<void> {
  const name = newName.value.trim()
  if (!name) return
  error.value = null
  const res = await window.api.createPrompt(name)
  if (!res.ok) { error.value = res.error; return }
  creating.value = false
  newName.value = ''
  await refresh()
  text.value = res.text
  original.value = res.text
  selected.value = { kind: 'prompt', name, description: '' }
}

async function doDelete(): Promise<void> {
  if (selected.value?.kind !== 'prompt') return
  const res = await window.api.deletePrompt(selected.value.name)
  confirmDelete.value = false
  if (!res.ok) { error.value = res.error; return }
  selected.value = null
  text.value = ''
  await refresh()
}
</script>

<template>
  <ModalShell title="Prompt Config" @close="emit('close')">
    <div class="pcfg">
      <aside class="pcfg-list">
        <button class="pcfg-item" :class="{ 'pcfg-item--on': selected?.kind === 'context' }" @click="requestSelect({ kind: 'context' })">
          <span class="pcfg-item__name">Ticket context</span>
          <span class="pcfg-item__desc">what &#123;&#123;ticket.context&#125;&#125; injects</span>
        </button>
        <button class="pcfg-item" :class="{ 'pcfg-item--on': selected?.kind === 'preamble' }" @click="requestSelect({ kind: 'preamble' })">
          <span class="pcfg-item__name">YOLO preamble</span>
          <span class="pcfg-item__desc">prepended to every YOLO prompt</span>
        </button>
        <button class="pcfg-item" :class="{ 'pcfg-item--on': selected?.kind === 'recap' }" @click="requestSelect({ kind: 'recap' })">
          <span class="pcfg-item__name">YOLO recap</span>
          <span class="pcfg-item__desc">appended to every YOLO prompt</span>
        </button>
        <button class="pcfg-item" :class="{ 'pcfg-item--on': selected?.kind === 'orchestrator' }" @click="requestSelect({ kind: 'orchestrator' })">
          <span class="pcfg-item__name">Jira Orchestrator</span>
          <span class="pcfg-item__desc">routes Jira tickets to playbooks</span>
        </button>
        <hr class="pcfg-sep" />
        <button
          v-for="p in prompts"
          :key="p.name"
          class="pcfg-item"
          :class="{ 'pcfg-item--on': selected?.kind === 'prompt' && selected.name === p.name }"
          @click="requestSelect({ kind: 'prompt', name: p.name, description: p.description })"
        >
          <span class="pcfg-item__name">{{ p.name }}</span>
          <span v-if="p.description" class="pcfg-item__desc">{{ p.description }}</span>
        </button>
        <button class="pcfg-new" @click="creating = !creating">+ New prompt</button>
        <!-- Plain div + click handler, not a form submit: jsdom (tests) never
             fires implicit form submission from a button click. Enter still
             works via the input's keyup handler. -->
        <div v-if="creating" class="pcfg-create-form">
          <input v-model="newName" class="pcfg-name" placeholder="prompt-name" @keyup.enter="create" />
          <button class="pcfg-create" type="button" :disabled="!newName.trim()" @click="create">Create</button>
        </div>
      </aside>
      <section class="pcfg-editor-pane">
        <template v-if="selected">
          <p v-if="selected.kind === 'preamble' && preambleDefault" class="pcfg-badge">using built-in default</p>
          <p v-if="selected.kind === 'recap' && recapDefault" class="pcfg-badge">using built-in default</p>
          <p v-if="selected.kind === 'orchestrator' && orchestratorDefault" class="pcfg-badge">using built-in default</p>
          <textarea
            v-model="text"
            class="pcfg-editor"
            spellcheck="false"
            :style="{ fontFamily: TERM_FONT_FAMILY, fontSize: TERM_FONT_SIZE + 'px' }"
          ></textarea>
          <p v-if="error" class="pcfg-error">{{ error }}</p>
          <div class="pcfg-actions">
            <button v-if="selected.kind === 'prompt'" class="pcfg-delete" @click="confirmDelete = true">Delete</button>
            <span class="pcfg-spacer"></span>
            <button class="pcfg-save" :disabled="text === original" @click="save">Save</button>
          </div>
        </template>
        <p v-else class="pcfg-empty">Select an entry to edit.</p>
        <p v-if="!selected && error" class="pcfg-error">{{ error }}</p>
      </section>
    </div>
  </ModalShell>
  <ConfirmDialog
    v-if="confirmDelete && selected?.kind === 'prompt'"
    title="Delete prompt"
    :message="`Delete prompt '${selected.name}'? The file is removed from disk.`"
    confirm-label="Delete"
    @confirm="doDelete"
    @cancel="confirmDelete = false"
  />
  <ConfirmDialog
    v-if="pendingSelect"
    title="Unsaved changes"
    message="Discard changes and switch?"
    confirm-label="Discard"
    @confirm="confirmSwitch"
    @cancel="pendingSelect = null"
  />
</template>

<style scoped>
.pcfg { display: flex; gap: 12px; min-width: 60vw; min-height: 48vh; }
.pcfg-list { width: 220px; display: flex; flex-direction: column; gap: 2px; overflow: auto; }
.pcfg-item {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  background: transparent; color: var(--ink); border: 0; border-radius: var(--radius-sm);
  padding: 7px 10px; cursor: pointer; text-align: left; width: 100%;
}
.pcfg-item:hover { background: var(--surface); }
.pcfg-item--on { background: var(--surface); outline: 1px solid var(--hairline-strong); }
.pcfg-item__name { font-weight: 600; }
.pcfg-item__desc { color: var(--ink-muted); font-size: 12px; }
.pcfg-sep { width: 100%; border: 0; border-top: 1px solid var(--hairline); margin: 6px 0; }
.pcfg-new {
  margin-top: 6px; background: var(--surface); color: var(--ink);
  border: 1px dashed var(--hairline-strong); border-radius: var(--radius-sm); padding: 6px; cursor: pointer;
}
.pcfg-create-form { display: flex; gap: 6px; margin-top: 6px; }
.pcfg-name {
  flex: 1; min-width: 0; background: var(--surface); color: var(--ink);
  border: 1px solid var(--hairline-strong); border-radius: var(--radius-sm); padding: 5px 8px;
}
.pcfg-create {
  background: var(--teal); color: var(--bg); border: 0; border-radius: var(--radius-sm);
  padding: 5px 10px; cursor: pointer; font-weight: 600;
}
.pcfg-create:disabled { opacity: 0.5; cursor: default; }
.pcfg-editor-pane { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.pcfg-badge { margin: 0 0 6px; color: var(--ink-muted); font-size: 12px; font-style: italic; }
.pcfg-editor {
  flex: 1; min-height: 34vh; resize: vertical; background: var(--surface); color: var(--ink);
  border: 1px solid var(--hairline-strong); border-radius: var(--radius-sm); padding: 10px;
  white-space: pre-wrap;
}
.pcfg-editor:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; border-color: transparent; }
.pcfg-error {
  margin: 8px 0 0; padding: 8px 10px; font-size: 12px; white-space: pre-wrap;
  color: var(--ink); background: color-mix(in oklch, var(--rust, #b3552e) 18%, var(--surface));
  border: 1px solid color-mix(in oklch, var(--rust, #b3552e) 45%, var(--hairline-strong));
  border-radius: var(--radius-sm);
}
.pcfg-actions { display: flex; align-items: center; margin-top: 8px; }
.pcfg-spacer { flex: 1; }
.pcfg-delete {
  background: transparent; color: var(--ink-soft); border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-sm); padding: 6px 12px; cursor: pointer;
}
.pcfg-save {
  background: var(--teal); color: var(--bg); border: 0; border-radius: var(--radius-sm);
  padding: 6px 18px; cursor: pointer; font-weight: 600;
}
.pcfg-save:disabled { opacity: 0.5; cursor: default; }
.pcfg-empty { color: var(--ink-muted); }
</style>
