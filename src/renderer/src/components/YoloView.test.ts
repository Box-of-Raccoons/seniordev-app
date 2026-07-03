import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import YoloView from './YoloView.vue'
import type { YoloExitEvent, YoloLogEvent, YoloPrEvent } from '../../../shared/ipc'

let logCb: (e: YoloLogEvent) => void
let prCb: (e: YoloPrEvent) => void
let exitCb: (e: YoloExitEvent) => void

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    startYolo: vi.fn().mockResolvedValue({ ok: true }),
    killYolo: vi.fn(),
    openExternal: vi.fn().mockResolvedValue({ ok: true }),
    onYoloLog: vi.fn((cb) => { logCb = cb; return () => {} }),
    onYoloPr: vi.fn((cb) => { prCb = cb; return () => {} }),
    onYoloExit: vi.fn((cb) => { exitCb = cb; return () => {} })
  }
})

function exitEvent(over: Partial<YoloExitEvent> = {}): YoloExitEvent {
  return { id: 'y1', exitCode: 0, sessionId: 'sid-1', cwd: 'C:/repos/proj', tool: 'claude', canResume: true, prUrls: [], ...over }
}

describe('YoloView', () => {
  it('starts the run and appends log lines', async () => {
    const w = mount(YoloView, { props: { id: 'y1', ticketKey: 'PROJ-1', prompt: { name: 'fix-bug' } } })
    await flushPromises()
    expect(window.api.startYolo).toHaveBeenCalledWith({ id: 'y1', ticketKey: 'PROJ-1', prompt: { name: 'fix-bug', text: undefined }, tool: undefined })
    logCb({ id: 'y1', text: 'working…' })
    logCb({ id: 'other', text: 'not mine' })
    await flushPromises()
    expect(w.text()).toContain('working…')
    expect(w.text()).not.toContain('not mine')
  })
  it('stacks PR cards', async () => {
    const w = mount(YoloView, { props: { id: 'y1', ticketKey: null, prompt: { text: 'p' } } })
    await flushPromises()
    prCb({ id: 'y1', url: 'https://github.com/a/b/pull/1', term: 'PR' })
    prCb({ id: 'y1', url: 'https://github.com/a/c/pull/2', term: 'PR' })
    await flushPromises()
    expect(w.findAll('.pr-card')).toHaveLength(2)
  })
  it('shows the resume button after exit and emits resume once', async () => {
    const w = mount(YoloView, { props: { id: 'y1', ticketKey: null, prompt: { text: 'p' } } })
    await flushPromises()
    exitCb(exitEvent())
    await flushPromises()
    const btn = w.get('button.yolo-resume')
    await btn.trigger('click')
    expect(w.emitted('resume')).toEqual([[{ sessionId: 'sid-1', cwd: 'C:/repos/proj', tool: 'claude' }]])
    expect((w.get('button.yolo-resume').element as HTMLButtonElement).disabled).toBe(true)
  })
  it('shows the unavailable note when canResume is false', async () => {
    const w = mount(YoloView, { props: { id: 'y1', ticketKey: null, prompt: { text: 'p' } } })
    await flushPromises()
    exitCb(exitEvent({ canResume: false, sessionId: undefined, exitCode: 3 }))
    await flushPromises()
    expect(w.find('button.yolo-resume').exists()).toBe(false)
    expect(w.text()).toContain('resume unavailable')
    expect(w.text()).toContain('exited with code 3')
  })
  it('renders a start failure and emits exited', async () => {
    ;(window.api.startYolo as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: 'boom' })
    const w = mount(YoloView, { props: { id: 'y1', ticketKey: null, prompt: { text: 'p' } } })
    await flushPromises()
    expect(w.text()).toContain('failed to start: boom')
    expect(w.emitted('exited')).toBeTruthy()
  })
  it('stop button kills the run but keeps the tab, log, and resume path', async () => {
    const w = mount(YoloView, { props: { id: 'y1', ticketKey: null, prompt: { text: 'p' } } })
    await flushPromises()
    logCb({ id: 'y1', text: 'going rogue…' })
    await flushPromises()
    const stopBtn = w.get('button.yolo-stop')
    await stopBtn.trigger('click')
    expect(window.api.killYolo).toHaveBeenCalledWith('y1')
    expect((w.get('button.yolo-stop').element as HTMLButtonElement).disabled).toBe(true)
    // The killed child's exit still arrives; footer replaces the stop control.
    exitCb(exitEvent({ exitCode: 1 }))
    await flushPromises()
    expect(w.find('button.yolo-stop').exists()).toBe(false)
    expect(w.text()).toContain('exited with code 1')
    expect(w.text()).toContain('going rogue…') // log survives the stop
    expect(w.find('button.yolo-resume').exists()).toBe(true) // session id was captured pre-kill
    // Unmount after the exit must not kill again.
    ;(window.api.killYolo as ReturnType<typeof vi.fn>).mockClear()
    w.unmount()
    expect(window.api.killYolo).not.toHaveBeenCalled()
  })
  it('kills the run on unmount only while still running', async () => {
    const w = mount(YoloView, { props: { id: 'y1', ticketKey: null, prompt: { text: 'p' } } })
    await flushPromises()
    w.unmount()
    expect(window.api.killYolo).toHaveBeenCalledWith('y1')
    const w2 = mount(YoloView, { props: { id: 'y2', ticketKey: null, prompt: { text: 'p' } } })
    await flushPromises()
    exitCb(exitEvent({ id: 'y2' }))
    await flushPromises()
    ;(window.api.killYolo as ReturnType<typeof vi.fn>).mockClear()
    w2.unmount()
    expect(window.api.killYolo).not.toHaveBeenCalled()
  })
})
