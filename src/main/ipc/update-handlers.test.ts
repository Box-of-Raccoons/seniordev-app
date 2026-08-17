import { describe, it, expect, vi, beforeEach } from 'vitest'

const handleMap = new Map<string, (...a: unknown[]) => unknown>()
const onMap = new Map<string, (...a: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (c: string, f: (...a: unknown[]) => unknown) => handleMap.set(c, f),
    on: (c: string, f: (...a: unknown[]) => unknown) => onMap.set(c, f)
  }
}))

import { registerUpdateIpc, type UpdaterLike } from './update-handlers'
import type { UpdateInfo } from '../../shared/ipc'

// A fake electron-updater: records config, captures listeners so a test can fire
// the real event names, and counts checks.
function fakeUpdater(): UpdaterLike & {
  fire: (event: string, arg?: unknown) => void
  checks: number
  installed: number
} {
  const listeners = new Map<string, (arg: unknown) => void>()
  return {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    checks: 0,
    installed: 0,
    on(event: string, listener: (...a: never[]) => void) {
      listeners.set(event, listener as (arg: unknown) => void)
      return this
    },
    checkForUpdates() {
      this.checks++
      return Promise.resolve({})
    },
    quitAndInstall() {
      this.installed++
    },
    fire(event: string, arg?: unknown) {
      listeners.get(event)?.(arg)
    }
  }
}

const sent: UpdateInfo[] = []
const sender = { send: (_c: string, payload: unknown) => sent.push(payload as UpdateInfo) }

beforeEach(() => {
  handleMap.clear()
  onMap.clear()
  sent.length = 0
})

describe('registerUpdateIpc (packaged)', () => {
  function setup() {
    const updater = fakeUpdater()
    const dispose = registerUpdateIpc({
      updater,
      getSender: () => sender,
      isPackaged: true,
      firstCheckMs: 5,
      intervalMs: 10_000
    })
    return { updater, dispose }
  }

  it('downloads in the background and stages the install for quit, never restarting on its own', () => {
    const { updater, dispose } = setup()
    expect(updater.autoDownload).toBe(true)
    expect(updater.autoInstallOnAppQuit).toBe(true)
    expect(updater.installed).toBe(0)
    dispose()
  })

  it('pushes each lifecycle transition to the renderer', () => {
    const { updater, dispose } = setup()
    updater.fire('checking-for-update')
    updater.fire('update-available', { version: '0.6.0' })
    updater.fire('download-progress', { percent: 62.4 })
    updater.fire('update-downloaded', { version: '0.6.0' })

    expect(sent.map((s) => s.state)).toEqual(['checking', 'downloading', 'downloading', 'ready'])
    expect(sent.at(-1)).toEqual({ state: 'ready', version: '0.6.0', supported: true })
    expect(sent[2].percent).toBe(62)
    dispose()
  })

  it('reports an updater error without throwing', () => {
    const { updater, dispose } = setup()
    updater.fire('error', { message: 'ENOTFOUND github.com' })
    expect(sent.at(-1)).toMatchObject({ state: 'error', message: 'ENOTFOUND github.com' })
    dispose()
  })

  it('serves the current status on demand and installs on request', async () => {
    const { updater, dispose } = setup()
    updater.fire('update-downloaded', { version: '0.6.0' })

    expect(await handleMap.get('update:get')!()).toEqual({ state: 'ready', version: '0.6.0', supported: true })
    onMap.get('update:install')!()
    expect(updater.installed).toBe(1)
    dispose()
  })

  it('checks on a timer, and a manual check triggers one immediately', async () => {
    vi.useFakeTimers()
    const updater = fakeUpdater()
    const dispose = registerUpdateIpc({
      updater,
      getSender: () => sender,
      isPackaged: true,
      firstCheckMs: 10,
      intervalMs: 100
    })
    expect(updater.checks).toBe(0) // nothing at startup: the first check is delayed
    await vi.advanceTimersByTimeAsync(10)
    expect(updater.checks).toBe(1)
    await vi.advanceTimersByTimeAsync(200)
    expect(updater.checks).toBe(3)

    await handleMap.get('update:check')!()
    expect(updater.checks).toBe(4)

    // Disposing stops the polling, so a closed app doesn't keep hitting the feed.
    dispose()
    await vi.advanceTimersByTimeAsync(500)
    expect(updater.checks).toBe(4)
    vi.useRealTimers()
  })
})

describe('registerUpdateIpc (unpackaged / pnpm dev)', () => {
  it('answers unsupported and touches nothing: no listeners, no timers, no network', async () => {
    vi.useFakeTimers()
    const updater = fakeUpdater()
    registerUpdateIpc({ updater, getSender: () => sender, isPackaged: false, firstCheckMs: 1, intervalMs: 1 })

    expect(await handleMap.get('update:get')!()).toEqual({ state: 'idle', supported: false })
    await vi.advanceTimersByTimeAsync(1000)
    expect(updater.checks).toBe(0)
    expect(updater.autoDownload).toBe(false)

    // Even an explicit check or install request stays inert in dev.
    await handleMap.get('update:check')!()
    onMap.get('update:install')!()
    expect(updater.checks).toBe(0)
    expect(updater.installed).toBe(0)
    expect(sent).toHaveLength(0)
    vi.useRealTimers()
  })
})
