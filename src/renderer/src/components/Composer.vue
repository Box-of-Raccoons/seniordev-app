<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { isTicketKey } from '../../../shared/ticket-key'
import { slugifyForBranch, sanitizeBranchRef } from '../../../shared/branch'
import type { PromptSummary, RepoInfo, WorktreeInfo } from '../../../shared/ipc'
import type { ComposerLaunch } from './composer-types'

// variant is fixed by the New-tab menu choice: 'agent' runs a CLI agent (Claude,
// Codex, …) with a role + prompt; 'terminal' opens a raw shell. For the 'agent'
// variant the specific CLI is chosen here (tool picker); `tool` prop just seeds
// the default (deep-link / programmatic entry points).
const props = defineProps<{
  variant: 'agent' | 'terminal'
  tool?: string
  // Optional prefill (deep-link entry point): seed folder/input/role.
  initialInput?: string
  initialFolder?: string
  initialRole?: string
  // S6: when launched from a project, the folder is fixed to the project. The name
  // is shown as a read-only header instead of the folder picker, and the folder is
  // pinned to initialFolder.
  projectName?: string
}>()
const emit = defineEmits<{ (e: 'launch', payload: ComposerLaunch): void }>()

const folder = ref(props.initialFolder ?? '')
// Once the user picks/edits the folder, stop auto-prefilling it from the ticket.
// A prefilled folder counts as chosen, so a detected ticket won't overwrite it.
const folderTouched = ref(!!props.initialFolder)
const role = ref('')
const input = ref(props.initialInput ?? '')
const yolo = ref(false)
const shell = ref('')
const tool = ref(props.tool ?? '')

// S5 worktree toggle (Task mode only). `wtInfo` is resolved live per folder (is it
// a git repo, the repo's branchPrefix, the project's remembered choice). The
// checkbox prefills from worktreeDefault until the user toggles it; the branch
// prefills as branchPrefix + a slug of the prompt until the user edits it.
const wtInfo = ref<WorktreeInfo>({ isRepo: false, branchPrefix: '', worktreeDefault: false })
const worktree = ref(false)
const worktreeTouched = ref(false)
const branch = ref('')
const branchTouched = ref(false)
// A worktree:create refusal (a branch/path collision) is shown here; on a refusal
// the composer does NOT launch, so the user can fix the branch and retry.
const createError = ref<string | null>(null)

const prompts = ref<PromptSummary[]>([])
const repos = ref<RepoInfo[]>([])
const recentFolders = ref<string[]>([])
const shells = ref<string[]>([])
const tools = ref<string[]>([])
const yoloAvailable = ref(false)

// S6: launched from a project → the folder is fixed; hide the picker, show a header.
const locked = computed(() => !!props.projectName)
const isTerminal = computed(() => props.variant === 'terminal')
// The composer is task-only now (bare "New Session" launches come from the sidebar
// + menu, not here): an agent composer always drives a role + task prompt.
const isTask = computed(() => !isTerminal.value)

// A ticket key (e.g. ISC-835) vs free text. Detection drives the hint and the
// folder prefill; the app hands the agent the key, which reads it via its MCP.
const detectedTicket = computed(() => {
  const v = input.value.trim()
  return v && isTicketKey(v) ? v.toUpperCase() : null
})

const canLaunch = computed(() => {
  if (!folder.value.trim()) return false
  return isTerminal.value ? !!shell.value : true
})

const launchLabel = computed(() =>
  isTerminal.value ? 'Open shell' : isTask.value && yolo.value ? 'Launch YOLO' : 'Launch'
)

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function baseName(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
}

onMounted(async () => {
  if (!isTerminal.value) {
    try {
      prompts.value = await window.api.listPrompts()
    } catch {
      prompts.value = []
    }
    const preferred = props.initialRole ?? 'orchestrator'
    role.value =
      prompts.value.find((p) => p.name === preferred)?.name ??
      prompts.value.find((p) => p.name === 'orchestrator')?.name ??
      prompts.value[0]?.name ??
      ''
    try {
      tools.value = await window.api.listTools()
    } catch {
      tools.value = []
    }
    // listTools() returns the default tool first; seed the picker from the prop
    // if given, else that default.
    if (!tool.value) tool.value = tools.value[0] ?? ''
    try {
      yoloAvailable.value = (await window.api.yoloCaps()).available
    } catch {
      yoloAvailable.value = false
    }
  } else {
    try {
      const s = await window.api.listShells()
      shells.value = s.shells
      shell.value = s.default
    } catch {
      shells.value = []
    }
  }
  try {
    repos.value = await window.api.listRepos()
  } catch {
    repos.value = []
  }
  try {
    recentFolders.value = await window.api.listRecentFolders()
  } catch {
    recentFolders.value = []
  }
  // Resolve the worktree state for the initial folder (the watch only fires on a
  // later change). Only meaningful for the agent variant, but harmless otherwise.
  if (!isTerminal.value) await refreshWorktreeInfo()
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

// Prefill the branch as branchPrefix + a slug of the prompt, until the user edits
// it (branchTouched, mirroring folderTouched). Always a valid ref; an empty prefix
// and empty prompt fall back to 'task'.
function prefillBranch(): void {
  if (branchTouched.value) return
  branch.value = sanitizeBranchRef(wtInfo.value.branchPrefix + slugifyForBranch(input.value))
}

// Resolve the worktree state for the current folder (git repo? branchPrefix?
// remembered choice?). Best-effort: a failure leaves the checkbox disabled. Prefill
// the checkbox from the remembered choice and re-derive the branch, unless the user
// has already taken over either control.
async function refreshWorktreeInfo(): Promise<void> {
  const f = folder.value.trim()
  if (!f) {
    wtInfo.value = { isRepo: false, branchPrefix: '', worktreeDefault: false }
  } else {
    try {
      wtInfo.value = await window.api.worktreeInfo(f)
    } catch {
      wtInfo.value = { isRepo: false, branchPrefix: '', worktreeDefault: false }
    }
  }
  if (!worktreeTouched.value) worktree.value = wtInfo.value.isRepo && wtInfo.value.worktreeDefault
  prefillBranch()
}

let wtDebounce: ReturnType<typeof setTimeout> | null = null
watch(folder, () => {
  createError.value = null
  if (wtDebounce) clearTimeout(wtDebounce)
  wtDebounce = setTimeout(() => void refreshWorktreeInfo(), 250)
})
// Re-derive the branch as the prompt changes (until the user edits the branch).
watch(input, () => prefillBranch())

function onBranchInput(): void {
  branchTouched.value = true
}
function onWorktreeToggle(): void {
  worktreeTouched.value = true
  createError.value = null
}

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

function onFormKeydown(e: KeyboardEvent): void {
  // Cmd/Ctrl+Enter launches from anywhere in the composer — the folder field, the
  // tool buttons, or the Task textarea — so Open mode (which has no textarea) is
  // keyboard-launchable too. Plain Enter in the textarea still makes a newline.
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    launch()
  }
}

async function launch(): Promise<void> {
  if (!canLaunch.value) return
  if (isTerminal.value) {
    emit('launch', { mode: 'terminal', folder: folder.value.trim(), shell: shell.value })
    return
  }
  const folderVal = folder.value.trim()
  // S5: a launch with the worktree checkbox on creates the worktree FIRST
  // (pre-flight). A collision refuses here — we surface the reason and do NOT launch,
  // so the agent never spawns in the wrong cwd. On success the worktree path rides
  // along and RightPanel makes it the cwd.
  let worktreePath: string | undefined
  let worktreeBranch: string | undefined
  const useWorktree = worktree.value && wtInfo.value.isRepo
  if (useWorktree) {
    createError.value = null
    try {
      const res = await window.api.createWorktree({ folder: folderVal, branch: sanitizeBranchRef(branch.value) })
      if (!res.ok) {
        createError.value = res.error
        return
      }
      worktreePath = res.worktreePath
      worktreeBranch = res.branch
    } catch (err) {
      createError.value = err instanceof Error ? err.message : String(err)
      return
    }
  }
  emit('launch', {
    mode: 'interactive',
    folder: folderVal,
    role: role.value || undefined,
    input: input.value.trim() || undefined,
    ticketKey: detectedTicket.value ?? undefined,
    yolo: yolo.value,
    tool: tool.value || undefined,
    worktreePath,
    branch: worktreeBranch,
    // Remember the per-project checkbox state.
    worktreeChoice: worktree.value
  })
}
</script>

<template>
  <form class="composer" @submit.prevent="launch" @keydown="onFormKeydown">
    <div class="composer__inner">
      <!-- S6: launched from a project — the folder is the project, shown as a
           read-only header instead of the picker. -->
      <div v-if="locked" class="proj-header">
        <span class="proj-header__label">Project</span>
        <span class="proj-header__name">{{ projectName }}</span>
      </div>

      <div v-if="!locked" class="field">
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
        <div v-if="recentFolders.length" class="repos" role="group" aria-label="Recent folders">
          <span class="chip-label">Recent</span>
          <button
            v-for="f in recentFolders"
            :key="f"
            type="button"
            class="chip"
            :title="f"
            @click="pickRepo(f)"
          >{{ baseName(f) }}</button>
        </div>
        <div v-if="repos.length" class="repos" role="group" aria-label="Configured repos">
          <span v-if="recentFolders.length" class="chip-label">Repos</span>
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

      <!-- Task mode: optional git worktree isolation for this run (S5). Beside the
           folder picker; disabled with a reason when the folder is not a git repo. -->
      <div v-if="isTask" class="field worktree">
        <label class="wt-check" :class="{ 'wt-check--off': !wtInfo.isRepo }">
          <input v-model="worktree" type="checkbox" :disabled="!wtInfo.isRepo" @change="onWorktreeToggle" />
          <span class="wt-text">
            run in a new worktree
            <span v-if="!wtInfo.isRepo" class="wt-reason">not a git repository</span>
          </span>
        </label>
        <div v-if="worktree && wtInfo.isRepo" class="wt-branch">
          <label class="flabel" for="composer-branch">Branch</label>
          <input
            id="composer-branch"
            v-model="branch"
            class="control"
            type="text"
            autocomplete="off"
            spellcheck="false"
            @input="onBranchInput"
          />
        </div>
        <span v-if="createError" class="hint hint--error" role="alert">{{ createError }}</span>
      </div>

      <!-- Agent: which CLI to launch (Claude, Codex, …). -->
      <div v-if="!isTerminal" class="field">
        <label class="flabel" id="composer-tool-label">Tool</label>
        <div class="seg" role="group" aria-labelledby="composer-tool-label">
          <button
            v-for="t in tools"
            :key="t"
            type="button"
            class="seg-btn"
            :class="{ 'seg-btn--on': tool === t }"
            :aria-pressed="tool === t"
            @click="tool = t"
          >{{ cap(t) }}</button>
        </div>
      </div>

      <!-- Task mode: a role + task prompt drive the agent. -->
      <template v-if="isTask">
        <div class="field">
          <label class="flabel" for="composer-role">Role</label>
          <select id="composer-role" v-model="role" class="control select">
            <option v-for="p in prompts" :key="p.name" :value="p.name">{{ p.name }}</option>
          </select>
        </div>

        <div class="field">
          <label class="flabel" for="composer-input">Ticket or description</label>
          <textarea
            id="composer-input"
            v-model="input"
            class="control textarea"
            rows="3"
            placeholder="ISC-835, or describe the task…"
            autocomplete="off"
          ></textarea>
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
      <template v-if="isTerminal">
        <div class="field">
          <label class="flabel" for="composer-shell">Shell</label>
          <select id="composer-shell" v-model="shell" class="control select">
            <option v-for="s in shells" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
      </template>

      <div class="launch-row">
        <span v-if="!isTerminal" class="kbd" aria-hidden="true">⌘⏎</span>
        <button
          type="submit"
          class="btn-primary"
          :class="{ 'btn-primary--yolo': isTask && yolo }"
          :disabled="!canLaunch"
        >{{ launchLabel }}</button>
      </div>
    </div>
  </form>
</template>

<style scoped>
.composer { height: 100%; overflow-y: auto; display: flex; justify-content: center; padding: 24px 20px; }
.composer__inner { width: 100%; max-width: 480px; display: flex; flex-direction: column; gap: 15px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.flabel { font-size: 12px; font-weight: 600; color: var(--ink-soft); }
/* S6 project header: the fixed launch scope, in place of the folder picker. */
.proj-header { display: flex; align-items: baseline; gap: 8px; padding: 2px 0; }
.proj-header__label { font-size: 12px; font-weight: 600; color: var(--ink-muted); }
.proj-header__name { font-size: 14px; font-weight: 600; color: var(--ink); }

.control {
  background: var(--surface); color: var(--ink);
  border: 1px solid var(--hairline-strong); border-radius: var(--radius-sm);
  padding: 8px 11px; font: inherit; font-size: 13.5px; width: 100%;
}
.control::placeholder { color: var(--ink-muted); }
.control:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; border-color: transparent; }
.select { appearance: none; cursor: pointer; }
.textarea { resize: vertical; min-height: 64px; line-height: 1.5; }

.folder-row { display: flex; gap: 8px; }
.folder-row .control { flex: 1; min-width: 0; }

.repos { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 2px; }
.chip-label { font-size: 11px; color: var(--ink-muted); margin-right: 2px; }
.chip {
  font-family: var(--font-mono, Consolas, monospace); font-size: 11px;
  background: var(--surface); color: var(--ink-soft);
  border: 1px solid var(--hairline); border-radius: 6px; padding: 3px 8px; cursor: pointer;
}
.chip:hover { color: var(--ink); border-color: var(--hairline-strong); }
.chip:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; }

/* Segmented toggle: mutually-exclusive choice (session mode, agent tool). */
.seg { display: inline-flex; gap: 2px; padding: 2px; align-self: flex-start;
  background: var(--surface); border: 1px solid var(--hairline-strong); border-radius: var(--radius-sm); }
.seg-btn {
  background: transparent; color: var(--ink-soft); border: 0; border-radius: calc(var(--radius-sm) - 2px);
  padding: 5px 14px; font: inherit; font-size: 13px; cursor: pointer;
}
.seg-btn:hover { color: var(--ink); }
.seg-btn--on { background: var(--surface-2); color: var(--ink); font-weight: 600; }
.seg-btn:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; }

.hint { font-size: 12px; color: var(--teal); }
.hint--muted { color: var(--ink-muted); }
.hint--error { color: var(--rust); }

/* S5 worktree controls. The checkbox mirrors the YOLO row's affordance; the reason
   text (not colour) carries the disabled state (DESIGN Color-Is-State). */
.worktree { gap: 8px; }
.wt-check { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
/* tan (secondary emphasis), not teal — the One Signal Rule reserves teal for the
   surface's one primary action (Launch). */
.wt-check input { accent-color: var(--tan); }
.wt-text { font-size: 12.5px; color: var(--ink-soft); }
.wt-reason { color: var(--ink-muted); font-size: 11px; margin-left: 6px; }
.wt-check--off { cursor: default; opacity: 0.7; }
.wt-branch { display: flex; flex-direction: column; gap: 6px; margin-top: 2px; }
.wt-branch .control { font-family: var(--font-mono, Consolas, monospace); font-size: 12.5px; }

.yolo { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
.yolo input { accent-color: var(--amber); }
.yolo__text { font-size: 12.5px; color: var(--ink-soft); }
.yolo__zap { color: var(--amber); }
.yolo__desc { color: var(--ink-muted); font-size: 11px; margin-left: 4px; }
.yolo--off { cursor: default; opacity: 0.7; }

.launch-row { display: flex; justify-content: flex-end; align-items: center; gap: 10px; margin-top: 2px; }
.kbd { font-family: var(--font-mono, Consolas, monospace); font-size: 11px; color: var(--ink-muted); }
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
