import { reactive } from 'vue'
import type { GateResultEvent, GateRunningEvent } from '../../../shared/ipc'

// Supervision slice 2, renderer half. Holds the latest gate state per tab and
// exposes it to the tab strip. Deliberately separate from `statuses` (TabStatus):
// the status describes the SESSION, the gate describes the CODE, and a tab can
// legitimately be `needsYou` with a passing gate or `idle` with a failing one.

export type GateState = 'running' | 'pass' | 'fail' | 'error'

export interface GateEntry {
  state: GateState
  summary: string
  command: string
  durationMs: number
}

export interface UseGates {
  forTab(ptyId: string): GateEntry | null
  forget(ptyId: string): void
  output(ptyId: string): Promise<string | null>
  run(ptyId: string): Promise<void>
  dispose(): void
}

// A distinct glyph per state so colour only ever reinforces it (DESIGN.md's
// Color-Is-State Rule). These are text, not SVG, because they sit inline in a
// tab label rather than standing alone the way StatusGlyph does.
const GLYPHS: Record<GateState, string> = {
  running: '·',
  pass: '✓',
  fail: '✗',
  error: '!'
}
export function gateGlyph(state: GateState): string {
  return GLYPHS[state] ?? '?'
}

export function gateLabel(e: GateEntry): string {
  const secs = e.durationMs > 0 ? ` in ${(e.durationMs / 1000).toFixed(1)}s` : ''
  switch (e.state) {
    case 'running':
      return `gate running: ${e.command}`
    case 'pass':
      return `gate passed${secs}: ${e.command}${e.summary ? ` — ${e.summary}` : ''}`
    case 'fail':
      return `gate failed${secs}: ${e.command}${e.summary ? ` — ${e.summary}` : ''}`
    case 'error':
      // NOT "failed": the gate itself broke (missing command, timeout), which
      // says nothing about the code. Calling that a failure blames the work.
      return `gate could not run: ${e.command}${e.summary ? ` — ${e.summary}` : ''}`
  }
}

export function useGates(): UseGates {
  const entries = reactive(new Map<string, GateEntry>())

  const offRunning = window.api.onGateRunning((e: GateRunningEvent) => {
    // A rerun drops the previous summary rather than showing last time's answer
    // next to a spinner, which would read as the current one.
    entries.set(e.ptyId, { state: 'running', summary: '', command: e.command, durationMs: 0 })
  })

  const offResult = window.api.onGateResult((e: GateResultEvent) => {
    entries.set(e.ptyId, {
      state: e.outcome,
      summary: e.summary,
      command: e.command,
      durationMs: e.durationMs
    })
  })

  return {
    forTab(ptyId) {
      return entries.get(ptyId) ?? null
    },
    forget(ptyId) {
      entries.delete(ptyId)
    },
    output(ptyId) {
      return window.api.gateOutput(ptyId)
    },
    run(ptyId) {
      return window.api.runGate(ptyId)
    },
    dispose() {
      offRunning()
      offResult()
    }
  }
}
