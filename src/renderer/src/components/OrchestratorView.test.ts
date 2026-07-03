import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import OrchestratorView from './OrchestratorView.vue'
import type { ClassifyResult, YoloLogEvent } from '../../../shared/ipc'

let logCb: (e: YoloLogEvent) => void
let resolveClassify: (result: ClassifyResult) => void

beforeEach(() => {
  resolveClassify = () => {}
  ;(window as unknown as { api: unknown }).api = {
    classifyTicket: vi.fn(() => new Promise<ClassifyResult>((resolve) => { resolveClassify = resolve })),
    killClassify: vi.fn(),
    onYoloLog: vi.fn((cb) => { logCb = cb; return () => {} })
  }
})

const YoloViewStub = {
  props: ['id', 'ticketKey', 'prompt', 'tool'],
  emits: ['exited', 'resume'],
  template: '<div class="yv-stub" :data-id="id" :data-prompt-name="prompt && prompt.name" />'
}

const stubs = { YoloView: YoloViewStub }

describe('OrchestratorView', () => {
  it('renders the classifying state on mount', async () => {
    const w = mount(OrchestratorView, {
      props: { id: 'o1', ticketKey: 'SD-6' },
      global: { stubs }
    })
    await flushPromises()
    expect(w.text()).toContain('Routing SD-6')
    expect(w.find('button.orch-cancel').exists()).toBe(true)
    expect(w.find('.yv-stub').exists()).toBe(false)
  })

  it('emits routed and mounts YoloView on classify success', async () => {
    const w = mount(OrchestratorView, {
      props: { id: 'o1', ticketKey: 'SD-6' },
      global: { stubs }
    })
    await flushPromises()
    resolveClassify({ ok: true, prompt: 'fix-bug' })
    await flushPromises()
    expect(w.emitted('routed')).toEqual([['fix-bug']])
    const stub = w.find('.yv-stub')
    expect(stub.exists()).toBe(true)
    expect(stub.attributes('data-id')).toBe('o1:run')
    expect(stub.attributes('data-prompt-name')).toBe('fix-bug')
    expect(w.text()).toContain('Jira Orchestrator → fix-bug')
  })

  it('shows the reason and does NOT mount YoloView on classify failure', async () => {
    const w = mount(OrchestratorView, {
      props: { id: 'o1', ticketKey: 'SD-6' },
      global: { stubs }
    })
    await flushPromises()
    resolveClassify({ ok: false, reason: 'no matching playbook' })
    await flushPromises()
    expect(w.text()).toContain('No playbook selected — no matching playbook')
    expect(w.find('.yv-stub').exists()).toBe(false)
    expect(w.emitted('routed')).toBeFalsy()
  })

  it('calls killClassify on unmount while still classifying', async () => {
    const w = mount(OrchestratorView, {
      props: { id: 'o1', ticketKey: 'SD-6' },
      global: { stubs }
    })
    await flushPromises()
    // Do not resolve — the classify promise is still pending.
    w.unmount()
    expect(window.api.killClassify).toHaveBeenCalledWith('o1:classify')
  })

  it('does NOT call killClassify on unmount after classify resolved', async () => {
    const w = mount(OrchestratorView, {
      props: { id: 'o1', ticketKey: 'SD-6' },
      global: { stubs }
    })
    await flushPromises()
    resolveClassify({ ok: true, prompt: 'fix-bug' })
    await flushPromises()
    ;(window.api.killClassify as ReturnType<typeof vi.fn>).mockClear()
    w.unmount()
    expect(window.api.killClassify).not.toHaveBeenCalled()
  })

  it('ignores log lines with ids other than classifyId', async () => {
    const w = mount(OrchestratorView, {
      props: { id: 'o1', ticketKey: 'SD-6' },
      global: { stubs }
    })
    await flushPromises()
    logCb({ id: 'o1:classify', text: 'classifier output' })
    logCb({ id: 'o1:run', text: 'should be ignored' })
    logCb({ id: 'other', text: 'also ignored' })
    await flushPromises()
    expect(w.text()).toContain('classifier output')
    expect(w.text()).not.toContain('should be ignored')
    expect(w.text()).not.toContain('also ignored')
  })

  it('cancel button calls killClassify', async () => {
    const w = mount(OrchestratorView, {
      props: { id: 'o1', ticketKey: 'SD-6' },
      global: { stubs }
    })
    await flushPromises()
    await w.get('button.orch-cancel').trigger('click')
    expect(window.api.killClassify).toHaveBeenCalledWith('o1:classify')
  })

  it('a cancelled run is presented as cancelled, not as a routing failure', async () => {
    const w = mount(OrchestratorView, {
      props: { id: 'o1', ticketKey: 'SD-6' },
      global: { stubs }
    })
    await flushPromises()
    await w.get('button.orch-cancel').trigger('click')
    // The killed child exits non-zero and the classify promise resolves ok:false —
    // that is the user's own cancel, not an error.
    resolveClassify({ ok: false, reason: 'classifier exited with code 143' })
    await flushPromises()
    expect(w.text()).toContain('Classification cancelled')
    expect(w.text()).not.toContain('No playbook selected')
    expect(w.text()).not.toContain('exited with code 143')
    expect(w.find('.yv-stub').exists()).toBe(false)
  })

  it('unmount after cancel does not kill again', async () => {
    const w = mount(OrchestratorView, {
      props: { id: 'o1', ticketKey: 'SD-6' },
      global: { stubs }
    })
    await flushPromises()
    await w.get('button.orch-cancel').trigger('click')
    ;(window.api.killClassify as ReturnType<typeof vi.fn>).mockClear()
    w.unmount()
    expect(window.api.killClassify).not.toHaveBeenCalled()
  })
})
