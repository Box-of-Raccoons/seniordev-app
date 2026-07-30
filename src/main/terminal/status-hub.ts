// The orchestration seam for S1 status. It holds each live tab's kind, prompt
// patterns, and current state, and turns the event streams into STATUS.update
// pushes. Idle detection is NOT here: the interactive TUIs repaint continuously,
// so byte silence never happens; the renderer instead reports buffer-content
// `active`/`settled` and the hub reacts. Exit resolution and the headless path
// stay in main.
//
// Pure and fully injectable: `sendUpdate` is supplied, so this is unit-testable
// with a fake and never imports Electron.

import type { StatusUpdateEvent, TabStatus } from '../../shared/ipc'
import { matchesPrompt } from '../../shared/prompt-match'
import { nextStatus, type TabKind } from './status'

export interface StatusHubDeps {
  sendUpdate: (ev: StatusUpdateEvent) => void
}

export interface StatusHub {
  /** A pty tab (agent TUI or shell) started; `patterns` are what its settled buffer is scanned for. */
  registerPty(id: string, kind: 'interactive' | 'shell', patterns: string[]): void
  /** A headless (YOLO) tab started; never scanned, works until it exits. */
  registerHeadless(id: string): void
  /** Output content changed (renderer buffer for a pty, or a headless log line). */
  active(id: string): void
  /** A pty tab's rendered buffer went stable; scan its text for an approval prompt. */
  settled(id: string, text: string): void
  /** The process exited. */
  exit(id: string, code: number): void
  /** The tab was killed/closed; drop it. */
  dispose(id: string): void
}

export function createStatusHub(deps: StatusHubDeps): StatusHub {
  const sessions = new Map<string, { kind: TabKind; patterns: string[]; status: TabStatus }>()

  // Push a state only when it actually changed, so a stream of active/settled
  // reports for the same state does not spam the renderer.
  function push(id: string, status: TabStatus): void {
    const s = sessions.get(id)
    if (!s || s.status === status) return
    s.status = status
    deps.sendUpdate({ id, status })
  }

  function start(id: string, kind: TabKind, patterns: string[]): void {
    sessions.set(id, { kind, patterns, status: 'working' })
    deps.sendUpdate({ id, status: 'working' })
  }

  return {
    registerPty(id, kind, patterns) {
      start(id, kind, patterns)
    },
    registerHeadless(id) {
      start(id, 'headless', [])
    },
    active(id) {
      const s = sessions.get(id)
      if (s) push(id, nextStatus(s.status, { type: 'data' }, s.kind))
    },
    settled(id, text) {
      const s = sessions.get(id)
      if (!s) return
      const promptMatched = matchesPrompt(text, s.patterns)
      push(id, nextStatus(s.status, { type: 'quiet', promptMatched }, s.kind))
    },
    exit(id, code) {
      const s = sessions.get(id)
      if (s) push(id, nextStatus(s.status, { type: 'exit', code }, s.kind))
    },
    dispose(id) {
      sessions.delete(id)
    }
  }
}
