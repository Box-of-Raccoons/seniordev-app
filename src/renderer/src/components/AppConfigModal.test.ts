// src/renderer/src/components/AppConfigModal.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AppConfigModal from './AppConfigModal.vue'

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    readConfig: vi.fn().mockResolvedValue({ ok: true, text: 'jira: {}\n', path: 'C:/cfg/config.yaml' }),
    saveConfig: vi.fn().mockResolvedValue({ ok: true })
  }
})

describe('AppConfigModal', () => {
  it('loads the file text and shows the path', async () => {
    const w = mount(AppConfigModal)
    await flushPromises()
    expect((w.get('textarea').element as HTMLTextAreaElement).value).toBe('jira: {}\n')
    expect(w.text()).toContain('C:/cfg/config.yaml')
  })
  it('shows the starter-template notice when isTemplate', async () => {
    ;(window.api.readConfig as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, text: '# starter', path: 'p', isTemplate: true })
    const w = mount(AppConfigModal)
    await flushPromises()
    expect(w.text()).toMatch(/starting template|no config file/i)
  })
  it('save success closes; save failure shows the error and keeps the modal', async () => {
    const w = mount(AppConfigModal)
    await flushPromises()
    await w.get('textarea').setValue('jira: {}\nx: 1\n')
    ;(window.api.saveConfig as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: 'bad yaml at line 2' })
    await w.get('button.cfg-save').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('bad yaml at line 2')
    expect(w.emitted('close')).toBeFalsy()
    ;(window.api.saveConfig as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true })
    await w.get('button.cfg-save').trigger('click')
    await flushPromises()
    expect(window.api.saveConfig).toHaveBeenLastCalledWith('jira: {}\nx: 1\n')
    expect(w.emitted('close')).toBeTruthy()
  })
  it('dirty cancel asks to discard; clean cancel closes immediately', async () => {
    const w = mount(AppConfigModal)
    await flushPromises()
    await w.get('button.cfg-cancel').trigger('click')
    expect(w.emitted('close')).toBeTruthy() // clean → straight out
    const w2 = mount(AppConfigModal)
    await flushPromises()
    await w2.get('textarea').setValue('edited')
    await w2.get('button.cfg-cancel').trigger('click')
    expect(w2.emitted('close')).toBeFalsy() // dirty → confirm first
    expect(w2.text()).toContain('Discard changes?')
    await w2.get('button.confirm-yes').trigger('click')
    expect(w2.emitted('close')).toBeTruthy()
  })
  it('a failed readConfig shows the error and keeps Save disabled', async () => {
    ;(window.api.readConfig as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: 'EACCES: denied' })
    const w = mount(AppConfigModal)
    await flushPromises()
    expect(w.text()).toContain('EACCES: denied')
    expect((w.get('button.cfg-save').element as HTMLButtonElement).disabled).toBe(true)
    await w.get('button.cfg-save').trigger('click')
    expect(window.api.saveConfig).not.toHaveBeenCalled() // nothing sensible to save
  })
})
