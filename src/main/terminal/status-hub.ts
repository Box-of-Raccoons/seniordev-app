// The orchestration seam for S1 status. It holds each live tab's kind, prompt
// patterns, and current state, and turns the raw event streams (pty data/exit,
// headless log/exit, and the renderer's scan replies) into STATUS.update pushes,
// driving the buffer scan through the shared activity tracker so quiet is
// detected in exactly one place.
//
// Pure and fully injectable: the two `send*` callbacks and the activity tracker
// are supplied, so this is unit-testable with fakes and never imports Electron.

import type { StatusScanRequest, StatusUpdateEvent, TabStatus } from '../../shared/ipc'
import type { SessionActivity } from './activity'
import { nextStatus, type TabKind } from './status'

export interface StatusHubDeps {
  activity: SessionActivity
  sendScanRequest: (req: StatusScanRequest) => void
  sendUpdate: (ev: StatusUpdateEvent) => void
  quietMs?: number
}

export interface StatusHub {
  /** A pty tab (agent TUI or shell) started; `patterns` are what its buffer is scanned for. */
  registerPty(id: string, kind: 'interactive' | 'shell', patterns: string[]): void
  /** A headless (YOLO) tab started; never scanned, works until it exits. */
  registerHeadless(id: string): void
  /** Output arrived (pty data or a headless log line). */
  data(id: string): void
  /** The renderer's answer to a scan request. */
  scanResult(id: string, promptMatched: boolean): void
  /** The process exited. */
  exit(id: string, code: number): void
  /** The tab was killed/closed; drop it. */
  dispose(id: string): void
}

const DEFAULT_QUIET_MS = 700

export function createStatusHub(deps: StatusHubDeps): StatusHub {
  const quietMs = deps.quietMs ?? DEFAULT_QUIET_MS
  const sessions = new Map<string, { kind: TabKind; patterns: string[]; status: TabStatus }>()
  const watchCancels = new Map<string, () => void>()

  // Push a state only when it actually changed, so idle output does not spam the
  // renderer with redundant updates.
  function push(id: string, status: TabStatus): void {
    const s = sessions.get(id)
    if (!s || s.status === status) return
    s.status = status
    deps.sendUpdate({ id, status })
  }

  function cancelWatch(id: string): void {
    watchCancels.get(id)?.()
    watchCancels.delete(id)
  }

  // Continuous quiet watch: on each quiet, ask the renderer to scan this tab's
  // buffer, then re-arm for the next quiet. The state transition waits for the
  // scanResult. Headless tabs are never scanned, so they never arm.
  function arm(id: string): void {
    const s = sessions.get(id)
    if (!s || s.kind === 'headless') return
    const cancel = deps.activity.watch(id, { quietMs }, () => {
      const cur = sessions.get(id)
      if (!cur) return
      deps.sendScanRequest({ id, patterns: cur.patterns })
      arm(id)
    })
    watchCancels.set(id, cancel)
  }

  function start(id: string, kind: TabKind, patterns: string[]): void {
    cancelWatch(id)
    sessions.set(id, { kind, patterns, status: 'working' })
    deps.sendUpdate({ id, status: 'working' })
    arm(id)
  }

  return {
    registerPty(id, kind, patterns) {
      start(id, kind, patterns)
    },
    registerHeadless(id) {
      start(id, 'headless', [])
    },
    data(id) {
      const s = sessions.get(id)
      if (s) push(id, nextStatus(s.status, { type: 'data' }, s.kind))
    },
    scanResult(id, promptMatched) {
      const s = sessions.get(id)
      if (s) push(id, nextStatus(s.status, { type: 'quiet', promptMatched }, s.kind))
    },
    exit(id, code) {
      const s = sessions.get(id)
      if (!s) return
      cancelWatch(id)
      push(id, nextStatus(s.status, { type: 'exit', code }, s.kind))
    },
    dispose(id) {
      cancelWatch(id)
      sessions.delete(id)
    }
  }
}
