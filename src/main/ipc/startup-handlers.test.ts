import { describe, it, expect, vi, beforeEach } from 'vitest'
const handleMap = new Map<string, (...a: unknown[]) => unknown>()
vi.mock('electron', () => ({ ipcMain: { handle: (c: string, f: (...a: unknown[]) => unknown) => handleMap.set(c, f) } }))
import { registerStartupIpc } from './startup-handlers'
beforeEach(() => handleMap.clear())

describe('registerStartupIpc', () => {
  it('returns the parsed startup options', async () => {
    const opts = { tickets: ['PROJ-1'], session: { mode: 'yolo' as const, promptName: 'fix' } }
    registerStartupIpc(opts)
    expect(await handleMap.get('startup:get')!()).toEqual(opts)
  })
})
