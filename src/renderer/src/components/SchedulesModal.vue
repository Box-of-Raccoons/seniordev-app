<!-- src/renderer/src/components/SchedulesModal.vue -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ModalShell from './ModalShell.vue'
import type { ConversationInfo, Schedule } from '../../../shared/ipc'
import { describeLastRun, describeNextRun, describeTarget, describeTrigger, needsAttention, outcomeLabel } from '../schedule-format'

const emit = defineEmits<{ (e: 'close'): void }>()

const schedules = ref<Schedule[]>([])
const conversations = ref<ConversationInfo[]>([])
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
    <p v-if="ordered.length === 0" class="sched__empty">
      Nothing scheduled. Schedule a prompt from a session's tab menu to have it delivered later.
    </p>
    <ul v-else class="sched__list">
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
