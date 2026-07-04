import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers = new Map<string, (...a: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => handlers.set(ch, fn) }
}))

import { registerIpc } from './handlers'
import type { Ticket } from '../../shared/types'

const ticket: Ticket = {
  key: 'PROJ-1', type: 'Bug', status: 'Open', summary: 's',
  descriptionAdf: null, acceptanceCriteria: null, comments: [], url: 'u'
}

beforeEach(() => handlers.clear())

const noRepo = (): null => null

describe('registerIpc', () => {
  it('returns { ok: true, ticket } on success', async () => {
    registerIpc(async () => ticket, noRepo)
    const res = await handlers.get('jira:getTicket')!({}, 'PROJ-1')
    expect(res).toEqual({ ok: true, ticket })
  })

  it('returns { ok: false, error } when the fetch throws', async () => {
    registerIpc(async () => { throw new Error('boom') }, noRepo)
    const res = await handlers.get('jira:getTicket')!({}, 'PROJ-1')
    expect(res).toEqual({ ok: false, error: 'boom' })
  })

  it('resolveRepo handler returns the resolver result (SD-9 S2)', async () => {
    const repo = { key: 'PROJ', path: '/repos/proj', tool: 'claude' }
    registerIpc(async () => ticket, (k) => (k === 'PROJ-1' ? repo : null))
    expect(await handlers.get('jira:resolveRepo')!({}, 'PROJ-1')).toEqual(repo)
    expect(await handlers.get('jira:resolveRepo')!({}, 'OTHER-1')).toBeNull()
  })
})
