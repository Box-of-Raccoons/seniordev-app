import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import NewTabMenu from './NewTabMenu.vue'

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    listTools: vi.fn(async () => ['claude', 'codex']),
    onConfigChanged: vi.fn(() => () => {})
  }
})

async function open() {
  const w = mount(NewTabMenu)
  await flushPromises()
  await w.find('.new-session').trigger('click')
  return w
}

describe('NewTabMenu', () => {
  it('lists the agent tools (capitalized) plus Terminal when opened', async () => {
    const w = await open()
    expect(w.findAll('.menu-item').map((b) => b.text())).toEqual(['Claude', 'Codex', 'Terminal'])
  })

  it('emits pick with the tool for an agent choice', async () => {
    const w = await open()
    await w.findAll('.menu-item')[0].trigger('click')
    expect(w.emitted('pick')?.[0]?.[0]).toEqual({ variant: 'agent', tool: 'claude' })
  })

  it('emits pick terminal for the Terminal choice', async () => {
    const w = await open()
    await w.findAll('.menu-item').at(-1)!.trigger('click')
    expect(w.emitted('pick')?.[0]?.[0]).toEqual({ variant: 'terminal' })
  })

  it('closes the menu after a pick', async () => {
    const w = await open()
    expect(w.find('.menu').exists()).toBe(true)
    await w.findAll('.menu-item')[0].trigger('click')
    expect(w.find('.menu').exists()).toBe(false)
  })
})
