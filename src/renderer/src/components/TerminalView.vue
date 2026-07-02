<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const props = defineProps<{ id: string; ticketKey: string | null }>()
const host = ref<HTMLDivElement | null>(null)
let term: Terminal | null = null
let fit: FitAddon | null = null
let offData: (() => void) | null = null
let offExit: (() => void) | null = null
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

  const res = await window.api.spawnTerminal({
    id: props.id,
    ticketKey: props.ticketKey ?? undefined,
    cols: term.cols,
    rows: term.rows
  })
  if (!res.ok) term.write(`\r\n[failed to start: ${res.error}]\r\n`)

  ro = new ResizeObserver(() => {
    fit?.fit()
    if (term) window.api.resizeTerminal(props.id, term.cols, term.rows)
  })
  ro.observe(host.value!)
})

onBeforeUnmount(() => {
  offData?.()
  offExit?.()
  ro?.disconnect()
  window.api.killTerminal(props.id)
  term?.dispose()
})
</script>

<template>
  <div ref="host" class="terminal-host"></div>
</template>

<style scoped>
.terminal-host { width: 100%; height: 100%; }
</style>
