<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { isTicketKey } from '../../../shared/ticket-key'
import type { PromptSummary, RepoInfo } from '../../../shared/ipc'
import type { ComposerLaunch } from './composer-types'

const emit = defineEmits<{ (e: 'launch', payload: ComposerLaunch): void }>()

const mode = ref<'interactive' | 'terminal'>('interactive')
const folder = ref('')
// Once the user picks/edits the folder, stop auto-prefilling it from the ticket.
const folderTouched = ref(false)
const role = ref('')
const input = ref('')
const yolo = ref(false)
const shell = ref('')

const prompts = ref<PromptSummary[]>([])
const repos = ref<RepoInfo[]>([])
const shells = ref<string[]>([])
const yoloAvailable = ref(false)

// A ticket key (e.g. ISC-835) vs free text. Detection drives the hint and the
// folder prefill; the app hands the agent the key, which reads it via its MCP.
const detectedTicket = computed(() => {
  const v = input.value.trim()
  return v && isTicketKey(v) ? v.toUpperCase() : null
})

const canLaunch = computed(() => {
  if (!folder.value.trim()) return false
  if (mode.value === 'terminal') return !!shell.value
  return true
})

const launchLabel = computed(() =>
  mode.value === 'terminal' ? 'Open shell' : yolo.value ? 'Launch YOLO' : 'Launch'
)

onMounted(async () => {
  try {
    prompts.value = await window.api.listPrompts()
  } catch {
    prompts.value = []
  }
  // Default to the orchestrator role when present, else the first listed prompt.
  role.value = prompts.value.find((p) => p.name === 'orchestrator')?.name ?? prompts.value[0]?.name ?? ''
  try {
    repos.value = await window.api.listRepos()
  } catch {
    repos.value = []
  }
  try {
    const s = await window.api.listShells()
    shells.value = s.shells
    shell.value = s.default
  } catch {
    shells.value = []
  }
  try {
    yoloAvailable.value = (await window.api.yoloCaps()).available
  } catch {
    yoloAvailable.value = false
  }
})

// Prefill the folder from the ticket's mapped repo, until the user takes over.
watch(detectedTicket, async (key) => {
  if (!key || folderTouched.value) return
  try {
    const repo = await window.api.resolveRepo(key)
    if (repo && !folderTouched.value) folder.value = repo.path
  } catch {
    /* leave the folder as-is */
  }
})

function pickRepo(path: string): void {
  folder.value = path
  folderTouched.value = true
}

async function browse(): Promise<void> {
  const picked = await window.api.pickFolder()
  if (picked) {
    folder.value = picked
    folderTouched.value = true
  }
}

function onFolderInput(): void {
  folderTouched.value = true
}

function launch(): void {
  if (!canLaunch.value) return
  if (mode.value === 'terminal') {
    emit('launch', { mode: 'terminal', folder: folder.value.trim(), shell: shell.value })
    return
  }
  emit('launch', {
    mode: 'interactive',
    folder: folder.value.trim(),
    role: role.value || undefined,
    input: input.value.trim() || undefined,
    ticketKey: detectedTicket.value ?? undefined,
    yolo: yolo.value
  })
}
</script>

<template>
  <form class="composer" @submit.prevent="launch">
    <div class="composer__inner">
      <!-- Universals: where + what kind -->
      <div class="toprow">
        <div class="field folder">
          <label class="flabel" for="composer-folder">Folder</label>
          <div class="folder-row">
            <input
              id="composer-folder"
              v-model="folder"
              class="control"
              type="text"
              placeholder="~/code/…"
              autocomplete="off"
              spellcheck="false"
              @input="onFolderInput"
            />
            <button type="button" class="btn-ghost" @click="browse">Browse…</button>
          </div>
          <div v-if="repos.length" class="repos" role="group" aria-label="Configured repos">
            <button
              v-for="r in repos"
              :key="r.key"
              type="button"
              class="chip"
              :title="r.path"
              @click="pickRepo(r.path)"
            >{{ r.key }}</button>
          </div>
        </div>

        <div class="field mode">
          <span class="flabel">Mode</span>
          <div class="modeswitch" role="group" aria-label="Session mode">
            <button
              type="button"
              class="seg"
              :class="{ 'seg--on': mode === 'interactive' }"
              @click="mode = 'interactive'"
            >Interactive</button>
            <button
              type="button"
              class="seg"
              :class="{ 'seg--on': mode === 'terminal' }"
              @click="mode = 'terminal'"
            >Terminal</button>
          </div>
        </div>
      </div>

      <!-- Interactive: a Claude session -->
      <template v-if="mode === 'interactive'">
        <div class="field">
          <label class="flabel" for="composer-role">Role</label>
          <select id="composer-role" v-model="role" class="control select">
            <option v-for="p in prompts" :key="p.name" :value="p.name">{{ p.name }}</option>
          </select>
        </div>

        <div class="field">
          <label class="flabel" for="composer-input">Ticket or description</label>
          <input
            id="composer-input"
            v-model="input"
            class="control"
            type="text"
            placeholder="ISC-835, or describe the task…"
            autocomplete="off"
          />
          <span v-if="detectedTicket" class="hint">detected ticket {{ detectedTicket }} · the agent reads it via its MCP</span>
          <span v-else-if="input.trim()" class="hint hint--muted">free text · used as the task description</span>
        </div>

        <label class="yolo" :class="{ 'yolo--off': !yoloAvailable }">
          <input v-model="yolo" type="checkbox" :disabled="!yoloAvailable" />
          <span class="yolo__text">
            <span class="yolo__zap" aria-hidden="true">⚡</span> YOLO
            <span class="yolo__desc">{{ yoloAvailable ? 'auto-run, ends in a PR' : 'default tool has no headless config' }}</span>
          </span>
        </label>
      </template>

      <!-- Terminal: a raw shell -->
      <template v-else>
        <p class="gated-note">Role and prompt are not used for a raw shell.</p>
        <div class="field">
          <label class="flabel" for="composer-shell">Shell</label>
          <select id="composer-shell" v-model="shell" class="control select">
            <option v-for="s in shells" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
      </template>

      <div class="launch-row">
        <button
          type="submit"
          class="btn-primary"
          :class="{ 'btn-primary--yolo': mode === 'interactive' && yolo }"
          :disabled="!canLaunch"
        >{{ launchLabel }}</button>
      </div>
    </div>
  </form>
</template>

<style scoped>
.composer { height: 100%; overflow-y: auto; display: flex; justify-content: center; padding: 24px 20px; }
.composer__inner { width: 100%; max-width: 440px; display: flex; flex-direction: column; gap: 15px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.flabel { font-size: 12px; font-weight: 600; color: var(--ink-soft); }

.toprow { display: flex; gap: 12px; align-items: flex-start; }
.toprow .folder { flex: 1 1 42%; min-width: 0; }
.toprow .mode { flex: 1 1 58%; min-width: 0; }

.control {
  background: var(--surface); color: var(--ink);
  border: 1px solid var(--hairline-strong); border-radius: var(--radius-sm);
  padding: 8px 11px; font: inherit; font-size: 13.5px; width: 100%;
}
.control::placeholder { color: var(--ink-muted); }
.control:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; border-color: transparent; }
.select { appearance: none; cursor: pointer; }

.folder-row { display: flex; gap: 8px; }
.folder-row .control { flex: 1; min-width: 0; }

.repos { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
.chip {
  font-family: var(--font-mono, Consolas, monospace); font-size: 11px;
  background: var(--surface); color: var(--ink-soft);
  border: 1px solid var(--hairline); border-radius: 6px; padding: 3px 8px; cursor: pointer;
}
.chip:hover { color: var(--ink); border-color: var(--hairline-strong); }
.chip:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; }

.modeswitch { display: flex; gap: 0; background: var(--surface); border: 1px solid var(--hairline-strong); border-radius: var(--radius-sm); padding: 3px; }
.seg {
  flex: 1; text-align: center; padding: 7px 6px; border: 0; background: transparent;
  color: var(--ink-muted); font: inherit; font-size: 12.5px; font-weight: 600; border-radius: 6px; cursor: pointer;
}
.seg--on { background: var(--surface-2); color: var(--ink); }
.seg:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; }

.hint { font-size: 12px; color: var(--teal); }
.hint--muted { color: var(--ink-muted); }

.gated-note { margin: 0; font-size: 12px; color: var(--ink-muted); text-align: center; }

.yolo { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
.yolo input { accent-color: var(--amber); }
.yolo__text { font-size: 12.5px; color: var(--ink-soft); }
.yolo__zap { color: var(--amber); }
.yolo__desc { color: var(--ink-muted); font-size: 11px; margin-left: 4px; }
.yolo--off { cursor: default; opacity: 0.7; }

.launch-row { display: flex; justify-content: flex-end; margin-top: 2px; }
.btn-primary {
  background: var(--teal); color: var(--bg); border: 0; border-radius: var(--radius-sm);
  padding: 8px 18px; font: inherit; font-weight: 600; font-size: 13.5px; cursor: pointer;
}
.btn-primary--yolo { background: var(--amber); }
.btn-primary:disabled { opacity: 0.45; cursor: default; }
.btn-primary:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.btn-ghost {
  background: transparent; color: var(--ink-soft);
  border: 1px solid var(--hairline-strong); border-radius: var(--radius-sm);
  padding: 8px 12px; font: inherit; font-size: 13px; cursor: pointer; white-space: nowrap;
}
.btn-ghost:hover { color: var(--ink); }
.btn-ghost:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; }
</style>
