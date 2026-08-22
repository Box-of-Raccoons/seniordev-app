<!-- src/renderer/src/components/SchedulesModal.vue -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ModalShell from './ModalShell.vue'
import type { ConversationInfo, Schedule } from '../../../shared/ipc'
import { describeLastRun, describeNextRun, describeTarget, describeTrigger, needsAttention, outcomeLabel } from '../schedule-format'
import { buildCreate, emptyDraft } from '../schedule-draft'

const emit = defineEmits<{ (e: 'close'): void }>()

const schedules = ref<Schedule[]>([])
const conversations = ref<ConversationInfo[]>([])
// Model suggestions per tool, from config. Empty is fine: the field is a text
// input either way, so a tool that lists none still accepts a typed id.
const toolModels = ref<Record<string, string[]>>({})
// Re-read on a tick so "in 20m" does not sit stale while the modal is open; the
// firing itself is main's, this only keeps the countdown honest.
const now = ref(Date.now())
let offChanged: (() => void) | null = null
let clockTimer: ReturnType<typeof setInterval> | null = null

async function refresh(): Promise<void> {
  try {
    schedules.value = await window.api.listSchedules()
  } catch {
    schedules.value = []
  }
}

onMounted(async () => {
  await refresh()
  try {
    conversations.value = await window.api.listConversations()
  } catch {
    conversations.value = []
  }
  try {
    toolModels.value = (await window.api.listToolModels?.()) ?? {}
  } catch {
    toolModels.value = {}
  }
  offChanged = window.api.onSchedulesChanged(() => void refresh())
  clockTimer = setInterval(() => (now.value = Date.now()), 15_000)
})
onBeforeUnmount(() => {
  offChanged?.()
  if (clockTimer) clearInterval(clockTimer)
})

const titleOf = (id: string): string | undefined => conversations.value.find((c) => c.id === id)?.title

// Enabled first, then soonest. A retired schedule stays visible (it is the record
// of what happened) but never above something still due to run.
const ordered = computed(() =>
  [...schedules.value].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.nextDueAt - b.nextDueAt)
)

// Creation lives here rather than in the composer: a schedule is authored, read,
// and retired in one place, and the form covers both target kinds so a recurring
// launch needs no separate surface.
const adding = ref(false)
const draft = ref(emptyDraft())
const formError = ref('')

// Only sessions that still exist can be scheduled into; a resume also needs the
// agent to have left a real transcript, which `resumable` answers freshly.
const targetable = computed(() => conversations.value.filter((c) => c.archivedAt === null))

function startAdding(): void {
  draft.value = emptyDraft()
  draft.value.conversationId = targetable.value[0]?.id ?? ''
  formError.value = ''
  adding.value = true
}

// Suggestions for whichever tool this schedule will launch. A blank tool means
// the app default, whose name the renderer does not know, so every configured
// tool's ids are offered rather than none.
const modelSuggestions = computed(() => {
  const forTool = draft.value.tool ? toolModels.value[draft.value.tool] : undefined
  return forTool ?? [...new Set(Object.values(toolModels.value).flat())]
})

async function pickFolder(): Promise<void> {
  const folder = await window.api.pickFolder()
  if (folder) draft.value.folder = folder
}

async function save(): Promise<void> {
  const built = buildCreate(draft.value, Date.now())
  if (!built.ok) {
    formError.value = built.error
    return
  }
  await window.api.createSchedule(built.create)
  adding.value = false
  await refresh()
}

async function toggle(s: Schedule): Promise<void> {
  await window.api.setScheduleEnabled(s.id, !s.enabled)
  await refresh()
}
async function remove(s: Schedule): Promise<void> {
  await window.api.removeSchedule(s.id)
  await refresh()
}
</script>

<template>
  <ModalShell title="Schedules" @close="emit('close')">
    <div class="sched__add">
      <button v-if="!adding" class="sched__btn" @click="startAdding">New schedule…</button>
      <form v-else class="form" @submit.prevent="save">
        <label class="form__row">
          <span>Deliver to</span>
          <select v-model="draft.targetKind">
            <option value="conversation">an existing session</option>
            <option value="launch">a new session</option>
          </select>
        </label>

        <label v-if="draft.targetKind === 'conversation'" class="form__row">
          <span>Session</span>
          <select v-model="draft.conversationId">
            <option v-for="c in targetable" :key="c.id" :value="c.id">{{ c.title || c.id }}</option>
          </select>
        </label>

        <template v-else>
          <div class="form__row">
            <span>Folder</span>
            <div class="form__folder">
              <input v-model="draft.folder" type="text" placeholder="/path/to/repo" />
              <button type="button" class="sched__btn" @click="pickFolder">Browse…</button>
            </div>
          </div>
          <label class="form__row">
            <span>Model</span>
            <span class="form__model">
              <input
                v-model="draft.model"
                type="text"
                list="sched-models"
                placeholder="the tool's default"
                aria-describedby="sched-model-help"
              />
              <datalist id="sched-models">
                <option v-for="m in modelSuggestions" :key="m" :value="m" />
              </datalist>
            </span>
          </label>
          <p id="sched-model-help" class="form__help">
            Leave blank to use whatever this tool would pick.
          </p>

          <label class="form__row">
            <span>Mode</span>
            <!-- Named explicitly: an unattended YOLO run on a timer is the most
                 consequential thing this form can create. -->
            <span class="form__check">
              <input v-model="draft.yolo" type="checkbox" />
              run as YOLO (auto-executes and opens a PR)
            </span>
          </label>
        </template>

        <label class="form__row">
          <span>Prompt</span>
          <textarea v-model="draft.prompt" rows="2" placeholder="continue" />
        </label>

        <label class="form__row">
          <span>When</span>
          <select v-model="draft.whenKind">
            <option value="once">once</option>
            <option value="daily">every day</option>
            <option value="every">on an interval</option>
          </select>
        </label>

        <label v-if="draft.whenKind !== 'every'" class="form__row">
          <span>At</span>
          <input v-model="draft.timeOfDay" type="time" />
        </label>
        <template v-else>
          <label class="form__row">
            <span>Every</span>
            <span class="form__check"><input v-model.number="draft.everyMinutes" type="number" min="1" /> minutes</span>
          </label>
          <label class="form__row">
            <span>Not before</span>
            <input v-model="draft.notBefore" type="time" />
          </label>
        </template>

        <label v-if="draft.whenKind !== 'once'" class="form__row">
          <span>Stop after</span>
          <span class="form__check"><input v-model.number="draft.maxFirings" type="number" min="1" /> runs</span>
        </label>

        <label class="form__row">
          <span>If missed</span>
          <span class="form__check">
            <input v-model="draft.catchUp" type="checkbox" />
            run it late (once) if SeniorDev was closed when it came due
          </span>
        </label>

        <p v-if="formError" class="form__error">{{ formError }}</p>
        <div class="form__actions">
          <button type="button" class="sched__btn" @click="adding = false">Cancel</button>
          <button type="submit" class="sched__btn sched__btn--go">Schedule it</button>
        </div>
      </form>
    </div>

    <p v-if="ordered.length === 0 && !adding" class="sched__empty">
      Nothing scheduled. New schedule sets up a prompt to be delivered to a session later, or on a rhythm.
    </p>
    <ul v-if="ordered.length" class="sched__list">
      <li v-for="s in ordered" :key="s.id" class="sched" :class="{ 'sched--off': !s.enabled }">
        <div class="sched__main">
          <p class="sched__title">{{ s.title }}</p>
          <p class="sched__target">{{ describeTarget(s, titleOf) }}</p>
          <p class="sched__when">
            {{ describeTrigger(s.trigger) }} &middot; next {{ describeNextRun(s, now) }}
          </p>
          <p class="sched__last" :class="{ 'sched__last--attention': needsAttention(s) }">
            <!-- The state word is text, never a bare colour: DESIGN.md, WCAG 2.1 AA. -->
            <span class="sched__badge">{{ outcomeLabel(s.lastOutcome) }}</span>
            {{ describeLastRun(s) }}
          </p>
        </div>
        <div class="sched__actions">
          <button class="sched__btn" @click="toggle(s)">{{ s.enabled ? 'Disable' : 'Enable' }}</button>
          <button class="sched__btn sched__btn--danger" @click="remove(s)">Delete</button>
        </div>
      </li>
    </ul>
  </ModalShell>
</template>

<style scoped>
.sched__empty { margin: 0; color: var(--ink-muted); }
.sched__add { margin-bottom: 12px; }
.form { display: flex; flex-direction: column; gap: 8px; }
.form__row { display: grid; grid-template-columns: 96px 1fr; align-items: center; gap: 10px; }
.form__row > span:first-child { color: var(--ink-muted); font-size: 13px; }
.form input[type='text'], .form input[type='time'], .form input[type='number'], .form select, .form textarea {
  background: var(--surface); color: var(--ink); border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-sm); padding: 5px 8px; font: inherit; min-width: 0;
}
.form textarea { resize: vertical; }
.form input[type='number'] { width: 72px; }
.form__folder { display: flex; gap: 6px; }
.form__folder input { flex: 1; }
.form__check { display: flex; align-items: center; gap: 6px; color: var(--ink-soft); font-size: 13px; }
.form__error { margin: 0; color: var(--amber); font-size: 13px; }
.form__model { display: flex; }
.form__model input { flex: 1; }
.form__help { margin: -4px 0 0 106px; color: var(--ink-muted); font-size: 12px; }
.form__actions { display: flex; justify-content: flex-end; gap: 6px; }
.sched__btn--go { border-color: var(--teal); color: var(--teal); }
.sched__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.sched {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  padding: 10px 12px; background: var(--surface); border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
}
.sched--off { opacity: 0.6; }
.sched__main { min-width: 0; }
.sched__main p { margin: 0; }
.sched__title { font-weight: 600; }
.sched__target, .sched__when { color: var(--ink-muted); font-size: 13px; }
.sched__last { font-size: 13px; color: var(--ink-soft); margin-top: 4px !important; }
.sched__last--attention { color: var(--amber); }
.sched__badge {
  display: inline-block; margin-right: 6px; padding: 0 6px;
  border: 1px solid var(--hairline-strong); border-radius: var(--radius-sm);
  font-size: 12px; text-transform: lowercase;
}
.sched__actions { display: flex; gap: 6px; flex: 0 0 auto; }
.sched__btn {
  background: transparent; color: var(--ink-soft); border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-sm); padding: 4px 10px; cursor: pointer; font-size: 13px;
}
.sched__btn:hover { color: var(--ink); }
.sched__btn--danger:hover { color: var(--rust); }
</style>
