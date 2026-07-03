<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import YoloView from './YoloView.vue'
import { TERM_FONT_FAMILY, TERM_FONT_SIZE } from '../term-style'

const props = defineProps<{
  id: string
  ticketKey: string
  tool?: string
}>()

const emit = defineEmits<{
  (e: 'routed', name: string): void
  (e: 'exited', code: number): void
  (e: 'resume', payload: { sessionId: string; cwd: string; tool: string }): void
}>()

// The classify run and the stage-2 YOLO run share the YOLO log channel;
// their ids must differ so each filters only its own lines.
const classifyId = `${props.id}:classify`
const runId = `${props.id}:run`

type Phase = 'classifying' | 'running' | 'failed' | 'cancelled'
const phase = ref<Phase>('classifying')
const classifyLog = ref<string[]>([])
const chosenName = ref('')
const failReason = ref('')
const logHost = ref<HTMLElement | null>(null)
let offLog: (() => void) | null = null
let unmounted = false

// Mirror YoloView's scroll-pin approach.
function append(text: string): void {
  const el = logHost.value
  const pinned = !el || el.scrollTop + el.clientHeight >= el.scrollHeight - 8
  classifyLog.value.push(text)
  if (pinned) {
    void nextTick(() => {
      const host = logHost.value
      if (host) host.scrollTop = host.scrollHeight
    })
  }
}

onMounted(async () => {
  offLog = window.api.onYoloLog((e) => {
    if (e.id === classifyId) append(e.text)
  })
  const result = await window.api.classifyTicket({
    id: classifyId,
    ticketKey: props.ticketKey,
    tool: props.tool
  })
  // A cancel kills the child, which resolves this promise as ok:false — that is
  // the user's own action, not a routing failure; the phase is already set.
  if (unmounted || phase.value === 'cancelled') return
  if (result.ok) {
    chosenName.value = result.prompt
    phase.value = 'running'
    emit('routed', result.prompt)
  } else {
    failReason.value = result.reason
    phase.value = 'failed'
  }
})

function cancel(): void {
  phase.value = 'cancelled'
  window.api.killClassify(classifyId)
}

onBeforeUnmount(() => {
  unmounted = true
  offLog?.()
  if (phase.value === 'classifying') window.api.killClassify(classifyId)
})
</script>

<template>
  <div class="orch-wrap">
    <template v-if="phase === 'classifying'">
      <div class="orch-header">
        <span class="orch-routing">Routing {{ ticketKey }}…</span>
        <button class="orch-cancel" @click="cancel">Cancel</button>
      </div>
      <pre
        ref="logHost"
        class="orch-log"
        :style="{ fontFamily: TERM_FONT_FAMILY, fontSize: TERM_FONT_SIZE + 'px' }"
      >{{ classifyLog.join('\n') }}</pre>
    </template>
    <template v-else-if="phase === 'cancelled'">
      <p class="orch-reason">Classification cancelled.</p>
      <pre
        class="orch-log"
        :style="{ fontFamily: TERM_FONT_FAMILY, fontSize: TERM_FONT_SIZE + 'px' }"
      >{{ classifyLog.join('\n') }}</pre>
    </template>
    <template v-else-if="phase === 'failed'">
      <p class="orch-reason">No playbook selected — {{ failReason }}</p>
      <pre
        class="orch-log"
        :style="{ fontFamily: TERM_FONT_FAMILY, fontSize: TERM_FONT_SIZE + 'px' }"
      >{{ classifyLog.join('\n') }}</pre>
    </template>
    <template v-else>
      <div class="orch-route-note">Jira Orchestrator → {{ chosenName }}</div>
      <div class="orch-run">
        <YoloView
          :id="runId"
          :ticket-key="ticketKey"
          :prompt="{ name: chosenName }"
          :tool="tool"
          @exited="$emit('exited', $event)"
          @resume="$emit('resume', $event)"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.orch-wrap { display: flex; flex-direction: column; height: 100%; }
.orch-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px; border-bottom: 1px solid var(--hairline);
  flex-shrink: 0;
}
.orch-routing { color: var(--ink-muted); font-size: 13px; }
.orch-cancel {
  background: transparent; color: var(--ink-soft);
  border: 1px solid var(--hairline-strong); border-radius: var(--radius-sm);
  padding: 4px 12px; cursor: pointer;
}
.orch-cancel:hover { color: var(--ink); }
.orch-cancel:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.orch-log {
  flex: 1; min-height: 0; overflow: auto; margin: 0; padding: 8px 10px;
  background: #1a1f1d; color: var(--ink); border-radius: var(--radius-sm);
  white-space: pre-wrap; word-break: break-word;
}
.orch-reason {
  margin: 0; padding: 10px 12px; flex-shrink: 0;
  color: var(--ink); font-weight: 600;
  border-bottom: 1px solid var(--hairline);
}
.orch-route-note {
  padding: 6px 10px; font-size: 12px; color: var(--ink-muted);
  border-bottom: 1px solid var(--hairline); flex-shrink: 0;
}
.orch-run { flex: 1; min-height: 0; }
</style>
