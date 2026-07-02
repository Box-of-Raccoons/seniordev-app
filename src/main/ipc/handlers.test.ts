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

describe('registerIpc', () => {
  it('returns { ok: true, ticket } on success', async () => {
    registerIpc(async () => ticket)
    const res = await handlers.get('jira:getTicket')!({}, 'PROJ-1')
    expect(res).toEqual({ ok: true, ticket })
  })

  it('returns { ok: false, error } when the fetch throws', async () => {
    registerIpc(async () => { throw new Error('boom') })
    const res = await handlers.get('jira:getTicket')!({}, 'PROJ-1')
    expect(res).toEqual({ ok: false, error: 'boom' })
  })
})
