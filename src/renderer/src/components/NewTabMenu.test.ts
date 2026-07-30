import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import NewTabMenu from './NewTabMenu.vue'

async function open(props?: Record<string, unknown>) {
  const w = mount(NewTabMenu, props ? { props } : undefined)
  await flushPromises()
  await w.find('.new-session').trigger('click')
  return w
}

describe('NewTabMenu', () => {
  it('offers New Session, AI Task and Terminal when opened (one tool: no submenu)', async () => {
    const w = await open({ tools: ['claude'] })
    expect(w.findAll('.menu-item').map((b) => b.text())).toEqual(['New Session', 'AI Task', 'Terminal'])
  })

  it('emits an agent pick (no tool — chosen later in the composer) for AI Task', async () => {
    const w = await open()
    await w.findAll('.menu-item').find((b) => b.text() === 'AI Task')!.trigger('click')
    expect(w.emitted('pick')?.[0]?.[0]).toEqual({ variant: 'agent' })
  })

  it('emits an Open-mode agent pick for New Session when only one tool is detected', async () => {
    const w = await open({ tools: ['claude'] })
    await w.findAll('.menu-item')[0].trigger('click') // New Session is first now
    expect(w.emitted('pick')?.[0]?.[0]).toEqual({ variant: 'agent', mode: 'open' })
  })

  it('New Session expands to a per-agent submenu when several tools are detected', async () => {
    const w = await open({ tools: ['claude', 'codex'] })
    // Clicking the parent (first item) toggles the submenu instead of emitting.
    await w.findAll('.menu-item')[0].trigger('click')
    expect(w.emitted('pick')).toBeUndefined()
    const subs = w.findAll('.menu-item--sub').map((b) => b.text())
    expect(subs).toEqual(['Claude', 'Codex'])
    // Choosing an agent emits an Open pick carrying that tool.
    await w.findAll('.menu-item--sub')[1].trigger('click')
    expect(w.emitted('pick')?.[0]?.[0]).toEqual({ variant: 'agent', mode: 'open', tool: 'codex' })
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

  it('anchors the menu with fixed viewport coordinates (escapes ancestor overflow clipping)', async () => {
    const w = await open()
    const style = w.find('.menu').attributes('style') ?? ''
    // Inline top/left are computed from the trigger rect on open, so the menu is
    // positioned against the viewport rather than clipped inside the sidebar scroll.
    expect(style).toContain('top:')
    expect(style).toContain('left:')
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
