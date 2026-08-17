import { ipcMain } from 'electron'
import { UPDATE, type UpdateInfo } from '../../shared/ipc'
import { IDLE, nextStatus, type UpdateStatus, type UpdaterEvent } from '../updater/update-status'

// The slice of electron-updater's autoUpdater this module touches, declared as an
// interface so the tests can drive the whole lifecycle with a fake — importing the
// real one pulls in Electron's app singleton.
export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on(event: string, listener: (...args: never[]) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(): void
}

export interface UpdateIpcDeps {
  updater: UpdaterLike
  getSender: () => { send: (channel: string, payload: unknown) => void } | undefined
  /** There is no updater in an unpackaged build; under `pnpm dev` this must no-op. */
  isPackaged: boolean
  /** Delay before the first check, so it doesn't compete with startup work. */
  firstCheckMs?: number
  /** How often to re-check while the app stays open. */
  intervalMs?: number
}

const FIRST_CHECK_MS = 10_000
const INTERVAL_MS = 6 * 60 * 60 * 1000

// Map electron-updater's event surface onto the reducer's vocabulary. Kept here
// (rather than in the reducer) so update-status.ts never sees electron-updater's
// payload shapes.
function bindEvents(updater: UpdaterLike, emit: (e: UpdaterEvent) => void): void {
  const on = (event: string, fn: (arg: never) => void): void => {
    updater.on(event, fn as (...a: never[]) => void)
  }
  on('checking-for-update', () => emit({ type: 'checking' }))
  on('update-available', (info: { version?: string }) => emit({ type: 'available', version: info?.version ?? '' }))
  on('update-not-available', () => emit({ type: 'none' }))
  on('download-progress', (p: { percent?: number }) => emit({ type: 'progress', percent: p?.percent ?? 0 }))
  on('update-downloaded', (info: { version?: string }) => emit({ type: 'downloaded', version: info?.version ?? '' }))
  on('error', (err: { message?: string }) => emit({ type: 'error', message: err?.message ?? 'update failed' }))
}

export function registerUpdateIpc(deps: UpdateIpcDeps): () => void {
  const { updater, getSender, isPackaged } = deps
  let status: UpdateStatus = IDLE
  const info = (): UpdateInfo => ({ ...status, supported: isPackaged })

  ipcMain.handle(UPDATE.get, (): UpdateInfo => info())
  ipcMain.handle(UPDATE.check, (): UpdateInfo => {
    // A manual check is best-effort: a rejected promise arrives as an 'error'
    // event too, and an unreachable feed must never break the modal that called it.
    if (isPackaged) void updater.checkForUpdates().catch(() => {})
    return info()
  })
  ipcMain.on(UPDATE.install, () => {
    if (isPackaged) updater.quitAndInstall()
  })

  // Unpackaged: the handlers above answer `supported: false` and nothing else runs
  // — no listeners, no timers, no network.
  if (!isPackaged) return () => {}

  // Download in the background and stage the install for quit. Never restart on
  // its own: this app holds live agent ptys, and taking them down to apply an
  // update is exactly the interruption the product is supposed to avoid.
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true

  bindEvents(updater, (e) => {
    status = nextStatus(status, e)
    getSender()?.send(UPDATE.status, info())
  })

  const check = (): void => void updater.checkForUpdates().catch(() => {})
  const first = setTimeout(check, deps.firstCheckMs ?? FIRST_CHECK_MS)
  const repeat = setInterval(check, deps.intervalMs ?? INTERVAL_MS)
  first.unref?.()
  repeat.unref?.()
  return () => {
    clearTimeout(first)
    clearInterval(repeat)
  }
}
