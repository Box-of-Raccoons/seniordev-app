<!-- src/renderer/src/components/YoloView.vue -->
<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import PrCard from './PrCard.vue'
import { TERM_BG, TERM_FONT_FAMILY, TERM_FONT_SIZE } from '../term-style'
import type { YoloExitEvent } from '../../../shared/ipc'

const props = defineProps<{
  id: string
  ticketKey: string | null
  prompt?: { name?: string; text?: string }
  tool?: string
}>()
const emit = defineEmits<{
  (e: 'exited', code: number): void
  (e: 'resume', payload: { sessionId: string; cwd: string; tool: string }): void
}>()

const lines = ref<string[]>([])
const prs = ref<{ url: string; term: string }[]>([])
const exit = ref<YoloExitEvent | null>(null)
const resumed = ref(false)
const logHost = ref<HTMLElement | null>(null)
let offLog: (() => void) | null = null
let offPr: (() => void) | null = null
let offExit: (() => void) | null = null

// Pin to bottom unless the user scrolled up to read.
function append(text: string): void {
  const el = logHost.value
  const pinned = !el || el.scrollTop + el.clientHeight >= el.scrollHeight - 8
  lines.value.push(text)
  // scrollTop assignment, not scrollTo(): jsdom (tests) implements only the property.
  if (pinned) {
    void nextTick(() => {
      const host = logHost.value
      if (host) host.scrollTop = host.scrollHeight
    })
  }
}

onMounted(async () => {
  offLog = window.api.onYoloLog((e) => { if (e.id === props.id) append(e.text) })
  offPr = window.api.onYoloPr((e) => { if (e.id === props.id) prs.value.push({ url: e.url, term: e.term }) })
  offExit = window.api.onYoloExit((e) => {
    if (e.id !== props.id) return
    exit.value = e
    emit('exited', e.exitCode)
  })
  try {
    // Unwrap the reactive prompt Proxy — ipcRenderer.invoke can't clone it.
    const res = await window.api.startYolo({
      id: props.id,
      ticketKey: props.ticketKey ?? undefined,
      prompt: props.prompt ? { name: props.prompt.name, text: props.prompt.text } : undefined,
      tool: props.tool
    })
    if (!res.ok) fail(res.error)
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err))
  }
})

function fail(error: string): void {
  append(`[failed to start: ${error}]`)
  exit.value = { id: props.id, exitCode: -1, cwd: '', tool: props.tool ?? '', canResume: false, prUrls: [] }
  emit('exited', -1)
}

function resume(): void {
  if (!exit.value?.sessionId || resumed.value) return
  resumed.value = true
  emit('resume', { sessionId: exit.value.sessionId, cwd: exit.value.cwd, tool: exit.value.tool })
}

// Stop keeps the tab: the tree-killed child's exit still flows through
// YOLO.exit, so the log, PR cards, and (if a session id was captured) the
// resume button all survive — unlike closing the tab, which discards them.
const stopping = ref(false)
function stop(): void {
  if (exit.value || stopping.value) return
  stopping.value = true
  window.api.killYolo(props.id)
}

onBeforeUnmount(() => {
  offLog?.()
  offPr?.()
  offExit?.()
  if (!exit.value) window.api.killYolo(props.id)
})
</script>

<template>
  <div class="yolo-wrap">
    <PrCard v-for="p in prs" :key="p.url" :url="p.url" :term="p.term" />
    <pre
      ref="logHost"
      class="yolo-log"
      :style="{ fontFamily: TERM_FONT_FAMILY, fontSize: TERM_FONT_SIZE + 'px', backgroundColor: TERM_BG }"
    >{{ lines.join('\n') }}</pre>
    <div v-if="!exit" class="yolo-footer">
      <span class="yolo-muted">running…</span>
      <button class="yolo-stop" :disabled="stopping" @click="stop">
        {{ stopping ? 'Stopping…' : '■ Stop' }}
      </button>
    </div>
    <div v-else class="yolo-footer">
      <span :class="exit.exitCode === 0 ? 'yolo-status--ok' : 'yolo-status--bad'">
        {{ exit.exitCode === 0 ? '✔ finished' : `✘ exited with code ${exit.exitCode}` }}
      </span>
      <button v-if="exit.canResume" class="yolo-resume" :disabled="resumed" @click="resume">
        Resume YOLO Session?
      </button>
      <span v-else class="yolo-muted">resume unavailable — no session id captured</span>
    </div>
  </div>
</template>

<style scoped>
.yolo-wrap { display: flex; flex-direction: column; height: 100%; }
.yolo-log {
  flex: 1; min-height: 0; overflow: auto; margin: 0; padding: 8px 10px;
  /* background comes from TERM_BG via inline style, matching the terminal */
  color: var(--ink); border-radius: var(--radius-sm);
  white-space: pre-wrap; word-break: break-word;
}
.yolo-footer {
  display: flex; align-items: center; gap: 12px; justify-content: space-between;
  padding: 8px 10px; border-top: 1px solid var(--hairline);
}
.yolo-status--ok { color: var(--green); font-weight: 600; }
.yolo-status--bad { color: var(--ink); font-weight: 600; }
.yolo-resume {
  background: var(--teal); color: var(--bg); border: 0;
  border-radius: var(--radius-sm); padding: 6px 14px; cursor: pointer; font-weight: 600;
}
.yolo-resume:disabled { opacity: 0.5; cursor: default; }
.yolo-resume:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.yolo-stop {
  background: transparent; color: var(--ink-soft);
  border: 1px solid var(--hairline-strong); border-radius: var(--radius-sm);
  padding: 6px 14px; cursor: pointer; font-weight: 600;
}
.yolo-stop:hover { color: var(--ink); }
.yolo-stop:disabled { opacity: 0.5; cursor: default; }
.yolo-stop:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.yolo-muted { color: var(--ink-muted); font-size: 12px; }
</style>
