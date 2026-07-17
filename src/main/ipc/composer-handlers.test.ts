import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers = new Map<string, (...a: unknown[]) => unknown>()
const showOpenDialog = vi.fn()
vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => handlers.set(ch, fn) },
  dialog: { showOpenDialog: (...a: unknown[]) => showOpenDialog(...a) },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }
}))

import { registerComposerIpc } from './composer-handlers'
import type { Config } from '../config/schema'

const config = {
  repos: [
    { key: 'SD', path: 'C:/repos/seniordev', branchPrefix: 'feature/' },
    { key: 'MP', path: 'C:/repos/mashpad', branchPrefix: 'feature/' }
  ]
} as unknown as Config

beforeEach(() => {
  handlers.clear()
  showOpenDialog.mockReset()
})

describe('registerComposerIpc', () => {
  it('repos:list returns the configured repos as {key, path}', async () => {
    registerComposerIpc({ getConfig: () => config })
    expect(await handlers.get('repos:list')!({})).toEqual([
      { key: 'SD', path: 'C:/repos/seniordev' },
      { key: 'MP', path: 'C:/repos/mashpad' }
    ])
  })

  it('repos:list is empty when config is unavailable', async () => {
    registerComposerIpc({ getConfig: () => undefined })
    expect(await handlers.get('repos:list')!({})).toEqual([])
  })

  it('dialog:pickFolder returns the chosen path', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['D:/chosen'] })
    registerComposerIpc({ getConfig: () => config })
    expect(await handlers.get('dialog:pickFolder')!({})).toBe('D:/chosen')
  })

  it('dialog:pickFolder returns null when cancelled', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    registerComposerIpc({ getConfig: () => config })
    expect(await handlers.get('dialog:pickFolder')!({})).toBeNull()
  })

  it('shells:list returns the platform shells with a default that is in the list', async () => {
    registerComposerIpc({ getConfig: () => config })
    const res = (await handlers.get('shells:list')!({})) as { shells: string[]; default: string }
    expect(Array.isArray(res.shells)).toBe(true)
    expect(res.shells.length).toBeGreaterThan(0)
    expect(res.shells).toContain(res.default)
  })
})
