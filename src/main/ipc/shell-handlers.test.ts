import { describe, it, expect, vi, beforeEach } from 'vitest'

const handleMap = new Map<string, (...a: unknown[]) => unknown>()
const openExternal = vi.fn(async (_url: string) => {})
vi.mock('electron', () => ({
  ipcMain: { handle: (c: string, f: (...a: unknown[]) => unknown) => handleMap.set(c, f) },
  shell: { openExternal: (url: string) => openExternal(url) }
}))

import { registerShellIpc } from './shell-handlers'

beforeEach(() => { handleMap.clear(); openExternal.mockClear() })

describe('registerShellIpc', () => {
  it('opens http(s) urls', async () => {
    registerShellIpc()
    const res = await handleMap.get('shell:openExternal')!({}, 'https://github.com/o/r/pull/1')
    expect(res).toEqual({ ok: true })
    expect(openExternal).toHaveBeenCalledWith('https://github.com/o/r/pull/1')
  })
  it('rejects non-http schemes without opening', async () => {
    registerShellIpc()
    const res = await handleMap.get('shell:openExternal')!({}, 'file:///etc/passwd')
    expect(res).toEqual({ ok: false })
    expect(openExternal).not.toHaveBeenCalled()
  })
})
