<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const props = defineProps<{ id: string; ticketKey: string | null; prompt?: { name?: string; text?: string }; yolo?: boolean }>()
const host = ref<HTMLDivElement | null>(null)
const pr = ref<{ url: string; term: string } | null>(null)
let term: Terminal | null = null
let fit: FitAddon | null = null
let offData: (() => void) | null = null
let offExit: (() => void) | null = null
let offPr: (() => void) | null = null
let ro: ResizeObserver | null = null

onMounted(async () => {
  term = new Terminal({ fontFamily: 'Consolas, monospace', fontSize: 13, cursorBlink: true, theme: { background: '#1a1f1d' } })
  fit = new FitAddon()
  term.loadAddon(fit)
  term.open(host.value!)
  fit.fit()

  term.onData((d) => window.api.writeTerminal(props.id, d))
  offData = window.api.onTerminalData((e) => { if (e.id === props.id) term?.write(e.data) })
  offExit = window.api.onTerminalExit((e) => { if (e.id === props.id) term?.write(`\r\n[process exited: ${e.exitCode}]\r\n`) })
  offPr = window.api.onTerminalPr((e) => { if (e.id === props.id) pr.value = { url: e.url, term: e.term } })

  try {
    const res = await window.api.spawnTerminal({
      id: props.id,
      ticketKey: props.ticketKey ?? undefined,
      cols: term.cols,
      rows: term.rows,
      prompt: props.prompt,
      yolo: props.yolo
    })
    if (!res.ok) term.write(`\r\n[failed to start: ${res.error}]\r\n`)
  } catch (err) {
    term.write(`\r\n[failed to start: ${err instanceof Error ? err.message : String(err)}]\r\n`)
  }

  ro = new ResizeObserver(() => {
    fit?.fit()
    if (term) window.api.resizeTerminal(props.id, term.cols, term.rows)
  })
  ro.observe(host.value!)
})

function openPr(): void {
  if (pr.value) window.api.openExternal(pr.value.url)
}

onBeforeUnmount(() => {
  offData?.()
  offExit?.()
  offPr?.()
  ro?.disconnect()
  window.api.killTerminal(props.id)
  term?.dispose()
})
</script>

<template>
  <div class="terminal-wrap">
    <div v-if="pr" class="pr-card">
      <span class="pr-card__label">✅ {{ pr.term }} ready</span>
      <button class="pr-card__open" @click="openPr">Open</button>
    </div>
    <div ref="host" class="terminal-host"></div>
  </div>
</template>

<style scoped>
.terminal-wrap { display: flex; flex-direction: column; height: 100%; }
.terminal-host { flex: 1; width: 100%; min-height: 0; }
.pr-card {
  display: flex; align-items: center; gap: 10px; justify-content: space-between;
  padding: 8px 12px; background: color-mix(in oklch, var(--green) 14%, var(--surface));
  border: 1px solid color-mix(in oklch, var(--green) 40%, var(--hairline-strong));
  border-radius: var(--radius-sm); margin: 0 0 6px;
}
.pr-card__label { color: var(--ink); font-weight: 600; }
.pr-card__open {
  background: var(--teal); color: var(--bg); border: 0;
  border-radius: var(--radius-sm); padding: 5px 14px; cursor: pointer; font-weight: 600;
}
.pr-card__open:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
</style>
