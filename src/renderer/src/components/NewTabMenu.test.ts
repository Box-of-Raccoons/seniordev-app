import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import NewTabMenu from './NewTabMenu.vue'

async function open() {
  const w = mount(NewTabMenu)
  await flushPromises()
  await w.find('.new-session').trigger('click')
  return w
}

describe('NewTabMenu', () => {
  it('offers AI, Open and Terminal when opened', async () => {
    const w = await open()
    expect(w.findAll('.menu-item').map((b) => b.text())).toEqual(['AI', 'Open', 'Terminal'])
  })

  it('emits an agent pick (no tool — chosen later in the composer) for AI', async () => {
    const w = await open()
    await w.findAll('.menu-item')[0].trigger('click')
    expect(w.emitted('pick')?.[0]?.[0]).toEqual({ variant: 'agent' })
  })

  it('emits an agent pick seeded into Open mode for Open', async () => {
    const w = await open()
    await w.findAll('.menu-item')[1].trigger('click')
    expect(w.emitted('pick')?.[0]?.[0]).toEqual({ variant: 'agent', mode: 'open' })
  })

  it('emits a terminal pick for Terminal', async () => {
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

  it('focuses the first item on open and moves focus with the arrow keys', async () => {
    const w = mount(NewTabMenu, { attachTo: document.body })
    await flushPromises()
    await w.find('.new-session').trigger('click')
    await flushPromises()
    const btns = w.findAll('.menu-item').map((b) => b.element)
    expect(document.activeElement).toBe(btns[0])
    await w.find('.menu').trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(btns[1])
    await w.find('.menu').trigger('keydown', { key: 'ArrowUp' })
    expect(document.activeElement).toBe(btns[0])
    w.unmount()
  })
})
