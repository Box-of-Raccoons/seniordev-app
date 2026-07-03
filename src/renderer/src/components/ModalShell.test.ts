import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ModalShell from './ModalShell.vue'

function esc(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
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
  it('overlay pointerdown closes; clicks inside the panel do not', async () => {
    const w = mount(ModalShell, { props: { title: 'T' } })
    await w.get('.modal').trigger('pointerdown')
    expect(w.emitted('close')).toBeUndefined()
    await w.get('.modal-overlay').trigger('pointerdown')
    expect(w.emitted('close')).toHaveLength(1)
    w.unmount()
  })
})
