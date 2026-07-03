// src/renderer/src/components/ConfirmDialog.test.ts
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ConfirmDialog from './ConfirmDialog.vue'

describe('ConfirmDialog', () => {
  it('renders message and emits confirm / cancel', async () => {
    const w = mount(ConfirmDialog, { props: { title: 'Reset?', message: 'Close everything?', confirmLabel: 'Reset' } })
    expect(w.text()).toContain('Close everything?')
    await w.get('button.confirm-yes').trigger('click')
    expect(w.emitted('confirm')).toBeTruthy()
    await w.get('button.confirm-no').trigger('click')
    expect(w.emitted('cancel')).toBeTruthy()
  })
})
