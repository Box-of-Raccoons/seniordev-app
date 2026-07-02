import { describe, it, expect, vi, beforeEach } from 'vitest'

const handleMap = new Map<string, (...a: unknown[]) => unknown>()
vi.mock('electron', () => ({ ipcMain: { handle: (c: string, f: (...a: unknown[]) => unknown) => handleMap.set(c, f) } }))

import { registerPromptsIpc } from './prompts-handlers'

beforeEach(() => handleMap.clear())

describe('registerPromptsIpc', () => {
  it('returns name+description summaries (not bodies)', async () => {
    registerPromptsIpc([{ name: 'fix', description: 'Fix it', body: 'SECRET BODY' }])
    const res = await handleMap.get('prompts:list')!()
    expect(res).toEqual([{ name: 'fix', description: 'Fix it' }])
  })
})
