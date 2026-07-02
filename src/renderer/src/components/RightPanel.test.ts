import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import RightPanel from './RightPanel.vue'

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    spawnTerminal: vi.fn(async () => ({ ok: true })),
    writeTerminal: vi.fn(), resizeTerminal: vi.fn(), killTerminal: vi.fn(),
    onTerminalData: vi.fn(() => () => {}), onTerminalExit: vi.fn(() => () => {})
  }
})

const stubs = { TerminalView: { props: ['id', 'ticketKey'], template: '<div class="tv" :data-id="id" />' } }

describe('RightPanel', () => {
  it('starts with no terminals and an empty state', () => {
    const w = mount(RightPanel, { props: { activeTicketKey: null }, global: { stubs } })
    expect(w.findAll('.term-tab')).toHaveLength(0)
    expect(w.text()).toContain('New session')
  })

  it('opens a terminal tab on New session', async () => {
    const w = mount(RightPanel, { props: { activeTicketKey: 'PROJ-1' }, global: { stubs } })
    await w.find('.new-session').trigger('click')
    expect(w.findAll('.term-tab')).toHaveLength(1)
    expect(w.findAll('.tv')).toHaveLength(1)
  })

  it('opens multiple tabs and closes one', async () => {
    const w = mount(RightPanel, { props: { activeTicketKey: null }, global: { stubs } })
    await w.find('.new-session').trigger('click')
    await w.find('.new-session').trigger('click')
    expect(w.findAll('.term-tab')).toHaveLength(2)
    await w.findAll('.term-tab__close')[0].trigger('click')
    expect(w.findAll('.term-tab')).toHaveLength(1)
  })
})
