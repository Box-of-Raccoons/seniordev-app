<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { TERM_BG, TERM_FONT_FAMILY, TERM_FONT_SIZE } from '../term-style'

const props = defineProps<{ id: string; ticketKey?: string | null; input?: string; prompt?: { name?: string; text?: string }; tool?: string; resume?: { sessionId: string }; cwdOverride?: string; shell?: string }>()
const emit = defineEmits<{ (e: 'exited', code: number): void }>()
const host = ref<HTMLDivElement | null>(null)
let term: Terminal | null = null
let fit: FitAddon | null = null
let offData: (() => void) | null = null
let offExit: (() => void) | null = null
let ro: ResizeObserver | null = null
// The tab can close during the awaited spawn round-trip below; onBeforeUnmount
// then disposes term and nulls host. This flag lets the async onMounted bail
// before touching a disposed terminal or a gone host (SD-9 B2; same guard as
// OrchestratorView).
let unmounted = false

onMounted(async () => {
  term = new Terminal({ fontFamily: TERM_FONT_FAMILY, fontSize: TERM_FONT_SIZE, cursorBlink: true, theme: { background: TERM_BG } })
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
    // A raw shell (Terminal mode) takes no prompt/tool — just the shell + cwd.
    const res = props.shell
      ? await window.api.spawnShell({
          id: props.id,
          shell: props.shell,
          cwd: props.cwdOverride ?? '',
          cols: term.cols,
          rows: term.rows
        })
      : await window.api.spawnTerminal({
          id: props.id,
          ticketKey: props.ticketKey ?? undefined,
          input: props.input,
          cwdOverride: props.cwdOverride,
          cols: term.cols,
          rows: term.rows,
          prompt: props.prompt ? { name: props.prompt.name, text: props.prompt.text } : undefined,
          resume: props.resume ? { sessionId: props.resume.sessionId } : undefined,
          tool: props.tool
        })
    // Closed mid-spawn → term is already disposed; don't write to it.
    if (unmounted) return
    if (!res.ok) term.write(`\r\n[failed to start: ${res.error}]\r\n`)
  } catch (err) {
    if (unmounted) return
    term.write(`\r\n[failed to start: ${err instanceof Error ? err.message : String(err)}]\r\n`)
  }

  // Same guard before wiring the observer: a null host would throw and a late
  // observer would leak past unmount.
  if (unmounted || !host.value) return
  ro = new ResizeObserver(() => {
    fit?.fit()
    if (term) window.api.resizeTerminal(props.id, term.cols, term.rows)
  })
  ro.observe(host.value)
})

onBeforeUnmount(() => {
  unmounted = true
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
