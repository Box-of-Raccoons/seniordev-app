import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import LeftPanel from './LeftPanel.vue'
import type { Ticket } from '../../../shared/types'

function ticket(key: string): Ticket {
  return {
    key, type: 'Bug', status: 'Open', summary: `Summary ${key}`,
    descriptionAdf: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'body' }] }] },
    acceptanceCriteria: null, comments: [], url: `https://x/browse/${key}`
  }
}

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    getTicket: vi.fn(async (key: string) =>
      key === 'BAD-1' ? { ok: false, error: 'Jira 404' } : { ok: true, ticket: ticket(key) }
    )
  }
})

async function open(wrapper: ReturnType<typeof mount>, key: string) {
  await wrapper.find('input').setValue(key)
  await wrapper.find('button').trigger('click')
  await flushPromises()
}

describe('LeftPanel', () => {
  it('opens a ticket into a tab and renders it', async () => {
    const w = mount(LeftPanel)
    await open(w, 'PROJ-1')
    expect(w.text()).toContain('Summary PROJ-1')
    expect(w.text()).toContain('body')
  })

  it('shows an inline error when the fetch fails', async () => {
    const w = mount(LeftPanel)
    await open(w, 'BAD-1')
    expect(w.text()).toContain('Jira 404')
  })

  it('re-activates an existing tab instead of duplicating', async () => {
    const w = mount(LeftPanel)
    await open(w, 'PROJ-1')
    await open(w, 'PROJ-1')
    expect(w.findAll('.tab')).toHaveLength(1)
  })

  it('opens a list of tickets via the exposed openTickets', async () => {
    const w = mount(LeftPanel)
    await (w.vm as unknown as { openTickets: (k: string[]) => Promise<void> }).openTickets(['PROJ-1', 'PROJ-2'])
    await flushPromises()
    expect(w.findAll('.tab')).toHaveLength(2)
  })

  it('prevents duplicate tabs when the same key is opened concurrently', async () => {
    let resolve!: (v: unknown) => void
    const controlled = new Promise((res) => { resolve = res })
    ;(window as unknown as { api: { getTicket: ReturnType<typeof vi.fn> } }).api.getTicket =
      vi.fn(() => controlled)

    const w = mount(LeftPanel)
    // Fire first open — openKey starts, adds key to pending, then suspends at getTicket
    await w.find('input').setValue('PROJ-1')
    await w.find('button').trigger('click')
    // Fire second open before first resolves — pending.has('PROJ-1') is true, early return
    await w.find('input').setValue('PROJ-1')
    await w.find('button').trigger('click')

    // Now let the first fetch resolve
    resolve({ ok: true, ticket: ticket('PROJ-1') })
    await flushPromises()

    expect(w.findAll('.tab')).toHaveLength(1)
  })

  it('sets activeKey to the first successfully opened key from openTickets when the first fails', async () => {
    const w = mount(LeftPanel)
    await (w.vm as unknown as { openTickets: (k: string[]) => Promise<void> }).openTickets(['BAD-1', 'PROJ-2'])
    await flushPromises()
    expect(w.findAll('.tab')).toHaveLength(1)
    expect(w.find('.tab--active').text()).toContain('PROJ-2')
  })
})
