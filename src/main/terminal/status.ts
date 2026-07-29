// Pure S1 status state machine: one of five glyph states per live tab, derived
// from terminal/headless events. No IPC, no Electron imports, no timers. Quiet
// detection (terminal/activity.ts) and the buffer scan (renderer) feed it their
// results; this module only decides the resulting state. See spec sections 5.1
// (states) and 5.2 (transitions).
//
// The five state values are the shared wire type TabStatus (src/shared/ipc.ts);
// the renderer needs them to draw glyphs. Only the type is shared — importing it
// pulls in no Electron, so this module stays pure main-process logic (spec 5.6).

import type { TabStatus } from '../../shared/ipc'

export type Status = TabStatus

// A tab's kind fixes how an exit resolves and whether it is ever scanned for a
// prompt. Interactive (agent TUI) and shell both ride the pty and get all five
// states; headless (YOLO) is never scanned — it works until it exits, then
// resolves to needsReview or failed. This is the two-event-source split from
// plan section 1.2: pty vs YOLO map to these kinds.
export type TabKind = 'interactive' | 'shell' | 'headless'

export type StatusEvent =
  // The tab (re)started: back to working. Used on spawn and on resume.
  | { type: 'spawn' }
  // Output arrived — pty data, or a headless log line: the session is working.
  | { type: 'data' }
  // The session fell quiet and the renderer scanned its buffer. Only emitted for
  // scannable (pty) kinds; `promptMatched` is the scan result.
  | { type: 'quiet'; promptMatched: boolean }
  // The process exited with `code`.
  | { type: 'exit'; code: number }

// Exit resolution — the spec 5.2 two-by-two. `autoClose` is the interactive/shell
// clean-exit cell: S3 will close the tab there. It is returned honestly here so
// S3 can act on it. S1 has no auto-close yet, so nextStatus renders that cell as
// a static failed dot (spec 10.5) until S3 lands.
export type ExitOutcome = Status | 'autoClose'

export function resolveExit(kind: TabKind, code: number): ExitOutcome {
  if (kind === 'headless') return code === 0 ? 'needsReview' : 'failed'
  // interactive / shell — both ride the pty and behave identically on exit.
  return code === 0 ? 'autoClose' : 'failed'
}

// Once a tab has exited there is no more output, so these states absorb any
// stray later event rather than flipping back to working.
const TERMINAL: ReadonlySet<Status> = new Set<Status>(['needsReview', 'failed'])

export const INITIAL_STATUS: Status = 'working'

// Reduce one event against the current state. `current` undefined means the tab
// has no status yet; spawn/data still resolve, other events no-op to working.
export function nextStatus(current: Status | undefined, event: StatusEvent, kind: TabKind): Status {
  switch (event.type) {
    case 'spawn':
      return 'working'
    case 'data':
      return current && TERMINAL.has(current) ? current : 'working'
    case 'quiet': {
      // Headless tabs are never scanned; a quiet event does not apply to them.
      if (kind === 'headless') return current ?? 'working'
      if (current && TERMINAL.has(current)) return current
      return event.promptMatched ? 'needsYou' : 'idle'
    }
    case 'exit': {
      const outcome = resolveExit(kind, event.code)
      // S1 interim: no auto-close, so a clean interactive exit shows a static
      // failed dot (spec 10.5). S3 replaces this by acting on `autoClose`.
      return outcome === 'autoClose' ? 'failed' : outcome
    }
  }
}
