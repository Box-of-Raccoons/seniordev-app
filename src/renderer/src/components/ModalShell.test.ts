import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import ModalShell from './ModalShell.vue'

function esc(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
}
function tab(shiftKey = false): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey }))
}

describe('ModalShell', () => {
  it('only the topmost shell answers Escape; parent takes over once the top closes', () => {
    const bottom = mount(ModalShell, { props: { title: 'Bottom' } })
    const top = mount(ModalShell, { props: { title: 'Top' } })
    esc()
    expect(top.emitted('close')).toHaveLength(1)
    expect(bottom.emitted('close')).toBeUndefined() // a stacked confirm must not drag its parent down
    top.unmount()
    esc()
    expect(bottom.emitted('close')).toHaveLength(1)
    bottom.unmount()
  })
  it('moves focus into the dialog on open and restores it to the opener on close', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    expect(document.activeElement).toBe(opener)

    const w = mount(ModalShell, {
      props: { title: 'T' },
      slots: { default: '<button class="inside">Inside</button>' },
      attachTo: document.body
    })
    await nextTick()
    expect(w.element.contains(document.activeElement)).toBe(true) // focus pulled inside

    w.unmount()
    expect(document.activeElement).toBe(opener) // focus returned to the trigger
    opener.remove()
  })

  it('traps Tab within the dialog, wrapping at both ends', async () => {
    const w = mount(ModalShell, {
      props: { title: 'T' },
      slots: { default: '<button class="a">A</button><button class="b">B</button>' },
      attachTo: document.body
    })
    await nextTick()
    const first = w.get('.modal__x').element as HTMLElement // header close, first focusable
    const last = w.get('.b').element as HTMLElement // last focusable

    last.focus()
    tab() // forward from last → wraps to first
    expect(document.activeElement).toBe(first)

    first.focus()
    tab(true) // backward from first → wraps to last
    expect(document.activeElement).toBe(last)
    w.unmount()
  })

  it('overlay pointerdown closes; clicks inside the panel do not', async () => {
    const w = mount(ModalShell, { props: { title: 'T' } })
    await w.get('.modal').trigger('pointerdown')
    expect(w.emitted('close')).toBeUndefined()
    await w.get('.modal-overlay').trigger('pointerdown')
    expect(w.emitted('close')).toHaveLength(1)
    w.unmount()
  })
})
