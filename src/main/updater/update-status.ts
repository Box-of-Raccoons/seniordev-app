// The update lifecycle as a pure reducer, kept free of electron-updater and IPC so
// the sequencing rules are testable on their own. The wiring in
// src/main/ipc/update-handlers.ts feeds real updater events through this and
// pushes each resulting status to the renderer.

import type { UpdateStatus } from '../../shared/ipc'

export type { UpdateStatus }

export type UpdaterEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'none' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }

export const IDLE: UpdateStatus = { state: 'idle' }

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

export function nextStatus(prev: UpdateStatus, e: UpdaterEvent): UpdateStatus {
  // A finished download always wins, including replacing an older staged version.
  if (e.type === 'downloaded') return { state: 'ready', version: e.version }
  // Once an update is downloaded it stays installable until the app restarts, so
  // the six-hourly poll that follows — a check, a "no update", or a network error
  // — must not erase the affordance the user is waiting to act on.
  if (prev.state === 'ready') return prev
  switch (e.type) {
    case 'checking':
      return { state: 'checking' }
    case 'available':
      return { state: 'downloading', version: e.version, percent: 0 }
    case 'none':
      return IDLE
    case 'progress':
      return { ...prev, state: 'downloading', percent: clampPercent(e.percent) }
    case 'error':
      return { state: 'error', message: e.message }
  }
}
