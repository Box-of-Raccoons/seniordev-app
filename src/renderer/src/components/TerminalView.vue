<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { TERM_FONT_FAMILY, TERM_FONT_SIZE } from '../term-style'

const props = defineProps<{ id: string; ticketKey: string | null; prompt?: { name?: string; text?: string }; tool?: string; resume?: { sessionId: string }; cwdOverride?: string }>()
const emit = defineEmits<{ (e: 'exited', code: number): void }>()
const host = ref<HTMLDivElement | null>(null)
let term: Terminal | null = null
let fit: FitAddon | null = null
let offData: (() => void) | null = null
let offExit: (() => void) | null = null
let ro: ResizeObserver | null = null

onMounted(async () => {
  term = new Terminal({ fontFamily: TERM_FONT_FAMILY, fontSize: TERM_FONT_SIZE, cursorBlink: true, theme: { background: '#1a1f1d' } })
  fit = new FitAddon()
  term.loadAddon(fit)
  term.open(host.value!)
  fit.fit()

  term.onData((d) => window.api.writeTerminal(props.id, d))
  offData = window.api.onTerminalData((e) => { if (e.id === props.id) term?.write(e.data) })
  offExit = window.api.onTerminalExit((e) => {
    if (e.id === props.id) {
      term?.write(`\r\n[process exited: ${e.exitCode}]\r\n`)
      emit('exited', e.exitCode)
    }
  })

  try {
    // Build a plain, structured-cloneable payload. props.prompt is a Vue
    // reactive Proxy, which contextBridge/ipcRenderer.invoke cannot clone
    // ("An object could not be cloned") — so unwrap it to a plain object.
    const res = await window.api.spawnTerminal({
      id: props.id,
      ticketKey: props.ticketKey ?? undefined,
      cwdOverride: props.cwdOverride,
      cols: term.cols,
      rows: term.rows,
      prompt: props.prompt ? { name: props.prompt.name, text: props.prompt.text } : undefined,
      resume: props.resume ? { sessionId: props.resume.sessionId } : undefined,
      tool: props.tool
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

onBeforeUnmount(() => {
  offData?.()
  offExit?.()
  ro?.disconnect()
  window.api.killTerminal(props.id)
  term?.dispose()
})
</script>

<template>
  <div class="terminal-wrap">
    <div ref="host" class="terminal-host"></div>
  </div>
</template>

<style scoped>
.terminal-wrap { display: flex; flex-direction: column; height: 100%; }
.terminal-host { flex: 1; width: 100%; min-height: 0; }
</style>
