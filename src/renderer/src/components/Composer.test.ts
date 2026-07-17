import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import Composer from './Composer.vue'

const resolveRepo = vi.fn(async () => ({ key: 'SD', path: 'C:/repos/sd', tool: 'claude' }))

beforeEach(() => {
  resolveRepo.mockClear()
  ;(window as unknown as { api: unknown }).api = {
    listPrompts: vi.fn(async () => [
      { name: 'orchestrator', description: 'default' },
      { name: 'senior-dev', description: 'build it' }
    ]),
    listRepos: vi.fn(async () => [{ key: 'SD', path: 'C:/repos/sd' }]),
    listShells: vi.fn(async () => ({ shells: ['pwsh', 'cmd'], default: 'pwsh' })),
    resolveRepo,
    yoloCaps: vi.fn(async () => ({ available: true }))
  }
})

async function mountComposer(variant: 'agent' | 'terminal' = 'agent', tool = 'claude') {
  const w = mount(Composer, { props: { variant, tool } })
  await flushPromises()
  return w
}

describe('Composer', () => {
  it('defaults the role to orchestrator when present', async () => {
    const w = await mountComposer()
    expect((w.find('#composer-role').element as HTMLSelectElement).value).toBe('orchestrator')
  })

  it('detects a ticket key vs free text and shows the right hint', async () => {
    const w = await mountComposer()
    await w.find('#composer-input').setValue('isc-835')
    expect(w.text()).toContain('detected ticket ISC-835')
    await w.find('#composer-input').setValue('document the CICD process')
    expect(w.text()).toContain('free text')
  })

  it('agent variant shows role + a multi-line input, no shell', async () => {
    const w = await mountComposer('agent')
    expect(w.find('#composer-role').exists()).toBe(true)
    expect(w.find('#composer-input').element.tagName).toBe('TEXTAREA')
    expect(w.find('#composer-shell').exists()).toBe(false)
  })

  it('terminal variant shows only a shell picker, no role/input', async () => {
    const w = await mountComposer('terminal')
    expect(w.find('#composer-role').exists()).toBe(false)
    expect(w.find('#composer-input').exists()).toBe(false)
    expect(w.find('#composer-shell').exists()).toBe(true)
  })

  it('requires a folder before launch is enabled', async () => {
    const w = await mountComposer()
    expect((w.find('button[type="submit"]').element as HTMLButtonElement).disabled).toBe(true)
    await w.find('#composer-folder').setValue('C:/x')
    expect((w.find('button[type="submit"]').element as HTMLButtonElement).disabled).toBe(false)
  })

  it('emits an interactive launch with role, input, ticket key, and tool', async () => {
    const w = await mountComposer('agent', 'claude')
    await w.find('#composer-folder').setValue('C:/work')
    await w.find('#composer-input').setValue('ISC-835')
    await w.find('form').trigger('submit')
    expect(w.emitted('launch')?.[0]?.[0]).toMatchObject({
      mode: 'interactive',
      folder: 'C:/work',
      role: 'orchestrator',
      input: 'ISC-835',
      ticketKey: 'ISC-835',
      yolo: false,
      tool: 'claude'
    })
  })

  it('relabels Launch to Launch YOLO and emits yolo:true when checked', async () => {
    const w = await mountComposer()
    await w.find('#composer-folder').setValue('C:/work')
    await w.find('.yolo input').setValue(true)
    expect(w.find('button[type="submit"]').text()).toBe('Launch YOLO')
    await w.find('form').trigger('submit')
    expect(w.emitted('launch')?.[0]?.[0]).toMatchObject({ yolo: true })
  })

  it('emits a terminal launch with the chosen shell and no role', async () => {
    const w = await mountComposer('terminal')
    await w.find('#composer-folder').setValue('C:/proj')
    await w.find('form').trigger('submit')
    expect(w.emitted('launch')?.[0]?.[0]).toEqual({ mode: 'terminal', folder: 'C:/proj', shell: 'pwsh' })
  })

  it('prefills the folder from the ticket-mapped repo until the user edits it', async () => {
    const w = await mountComposer()
    await w.find('#composer-input').setValue('SD-42')
    await flushPromises()
    expect(resolveRepo).toHaveBeenCalledWith('SD-42')
    expect((w.find('#composer-folder').element as HTMLInputElement).value).toBe('C:/repos/sd')
  })

  it('does not overwrite a folder the user already chose', async () => {
    const w = await mountComposer()
    await w.find('#composer-folder').setValue('D:/mine')
    await w.find('#composer-input').setValue('SD-42')
    await flushPromises()
    expect((w.find('#composer-folder').element as HTMLInputElement).value).toBe('D:/mine')
  })
})
