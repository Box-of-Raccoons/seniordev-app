// src/renderer/src/components/PromptConfigModal.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PromptConfigModal from './PromptConfigModal.vue'

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    listPrompts: vi.fn().mockResolvedValue([{ name: 'fix-bug', description: 'Fix a bug' }]),
    readPrompt: vi.fn().mockResolvedValue({ ok: true, text: '---\nname: fix-bug\n---\nbody' }),
    writePrompt: vi.fn().mockResolvedValue({ ok: true }),
    createPrompt: vi.fn().mockResolvedValue({ ok: true, text: '---\nname: new-one\n---\n' }),
    deletePrompt: vi.fn().mockResolvedValue({ ok: true }),
    readContext: vi.fn().mockResolvedValue({ ok: true, text: 'CTX {{ticket.key}}' }),
    writeContext: vi.fn().mockResolvedValue({ ok: true }),
    readRecap: vi.fn().mockResolvedValue({ text: 'RECAP', isDefault: true }),
    saveRecap: vi.fn().mockResolvedValue({ ok: true })
  }
})

async function open(): Promise<ReturnType<typeof mount>> {
  const w = mount(PromptConfigModal)
  await flushPromises()
  return w
}

describe('PromptConfigModal', () => {
  it('lists specials pinned first, then prompts', async () => {
    const w = await open()
    const items = w.findAll('.pcfg-item').map((i) => i.text())
    expect(items[0]).toContain('Ticket context')
    expect(items[1]).toContain('YOLO recap')
    expect(items[2]).toContain('fix-bug')
  })
  it('selecting the context loads it; save calls writeContext', async () => {
    const w = await open()
    await w.findAll('.pcfg-item')[0].trigger('click')
    await flushPromises()
    expect((w.get('textarea').element as HTMLTextAreaElement).value).toBe('CTX {{ticket.key}}')
    await w.get('textarea').setValue('NEW CTX')
    await w.get('button.pcfg-save').trigger('click')
    expect(window.api.writeContext).toHaveBeenCalledWith('NEW CTX')
  })
  it('recap shows the default badge and saves via saveRecap', async () => {
    const w = await open()
    await w.findAll('.pcfg-item')[1].trigger('click')
    await flushPromises()
    expect(w.text()).toContain('using built-in default')
    await w.get('textarea').setValue('MY RECAP')
    await w.get('button.pcfg-save').trigger('click')
    expect(window.api.saveRecap).toHaveBeenCalledWith('MY RECAP')
  })
  it('editing a prompt round-trips through readPrompt/writePrompt and surfaces errors', async () => {
    const w = await open()
    await w.findAll('.pcfg-item')[2].trigger('click')
    await flushPromises()
    expect(window.api.readPrompt).toHaveBeenCalledWith('fix-bug')
    ;(window.api.writePrompt as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: 'name collides' })
    await w.get('textarea').setValue('---\nname: one\n---\nx')
    await w.get('button.pcfg-save').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('name collides')
  })
  it('create asks for a name and selects the new prompt', async () => {
    const w = await open()
    await w.get('button.pcfg-new').trigger('click')
    await w.get('input.pcfg-name').setValue('new-one')
    await w.get('button.pcfg-create').trigger('click')
    await flushPromises()
    expect(window.api.createPrompt).toHaveBeenCalledWith('new-one')
    expect(window.api.listPrompts).toHaveBeenCalledTimes(2) // initial + refresh
  })
  it('delete confirms then calls deletePrompt and refreshes', async () => {
    const w = await open()
    await w.findAll('.pcfg-item')[2].trigger('click')
    await flushPromises()
    await w.get('button.pcfg-delete').trigger('click')
    expect(w.text()).toContain('Delete prompt')
    await w.get('button.confirm-yes').trigger('click')
    await flushPromises()
    expect(window.api.deletePrompt).toHaveBeenCalledWith('fix-bug')
  })
})
