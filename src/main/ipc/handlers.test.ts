import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers = new Map<string, (...a: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => handlers.set(ch, fn) }
}))

import { registerReposIpc } from './handlers'

beforeEach(() => handlers.clear())

describe('registerReposIpc', () => {
  it('resolveRepo handler returns the resolver result', async () => {
    const repo = { key: 'PROJ', path: '/repos/proj', tool: 'claude' }
    registerReposIpc((k) => (k === 'PROJ-1' ? repo : null))
    expect(await handlers.get('repos:resolve')!({}, 'PROJ-1')).toEqual(repo)
    expect(await handlers.get('repos:resolve')!({}, 'OTHER-1')).toBeNull()
  })
})
