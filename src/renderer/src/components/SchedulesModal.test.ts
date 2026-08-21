import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import SchedulesModal from './SchedulesModal.vue'
import type { Schedule } from '../../../shared/ipc'

const HOUR = 3600_000

function schedule(over: Partial<Schedule> = {}): Schedule {
  return {
    id: 's1',
    enabled: true,
    title: 'continue after the limit resets',
    target: { kind: 'conversation', conversationId: 'c1' },
    prompt: 'continue',
    trigger: { kind: 'daily', hour: 5, minute: 0 },
    catchUp: false,
    maxFirings: 10,
    stopOnFailure: true,
    firedCount: 0,
    nextDueAt: Date.now() + 4 * HOUR,
    lastFiredAt: null,
    lastOutcome: null,
    lastReason: null,
    deferredSinceAt: null,
    createdAt: 0,
    ...over
  }
}

const stubs = {
  ModalShell: { name: 'ModalShell', props: ['title'], template: '<div class="shell"><slot /></div>' }
}

let listSchedules: ReturnType<typeof vi.fn>
let setScheduleEnabled: ReturnType<typeof vi.fn>
let removeSchedule: ReturnType<typeof vi.fn>
let createSchedule: ReturnType<typeof vi.fn>

beforeEach(() => {
  listSchedules = vi.fn().mockResolvedValue([])
  setScheduleEnabled = vi.fn().mockResolvedValue(undefined)
  removeSchedule = vi.fn().mockResolvedValue(undefined)
  createSchedule = vi.fn().mockResolvedValue(undefined)
  ;(window as unknown as { api: unknown }).api = {
    listSchedules,
    setScheduleEnabled,
    removeSchedule,
    onSchedulesChanged: vi.fn(() => () => {}),
    createSchedule,
    pickFolder: vi.fn().mockResolvedValue('/picked/repo'),
    listConversations: vi
      .fn()
      .mockResolvedValue([{ id: 'c1', title: 'GG-14 login fix', archivedAt: null }])
  }
})

const mountModal = () => mount(SchedulesModal, { global: { stubs } })

describe('SchedulesModal', () => {
  it('says plainly when nothing is scheduled', async () => {
    const w = mountModal()
    await flushPromises()
    expect(w.text()).toContain('Nothing scheduled')
  })

  it('shows what a schedule does, when it next runs, and what it points at', async () => {
    listSchedules.mockResolvedValue([schedule()])
    const w = mountModal()
    await flushPromises()
    expect(w.text()).toContain('continue after the limit resets')
    expect(w.text()).toContain('daily at 05:00')
    expect(w.text()).toContain('GG-14 login fix')
  })

  it('shows a refused firing with its reason, not just a status word', async () => {
    // The whole point of refusing to type into a session awaiting approval is that
    // the user can see it happened and why.
    listSchedules.mockResolvedValue([
      schedule({ lastOutcome: 'skipped', lastReason: 'the session is waiting on you at a prompt' })
    ])
    const w = mountModal()
    await flushPromises()
    expect(w.text()).toContain('the session is waiting on you at a prompt')
    expect(w.text()).toContain('skipped')
  })

  it('names a recurring YOLO launch as such', async () => {
    listSchedules.mockResolvedValue([
      schedule({ target: { kind: 'launch', session: { mode: 'yolo', folder: '/repo' } } })
    ])
    const w = mountModal()
    await flushPromises()
    expect(w.text()).toContain('new YOLO session in /repo')
  })

  it('toggles and deletes through the bridge', async () => {
    listSchedules.mockResolvedValue([schedule()])
    const w = mountModal()
    await flushPromises()
    const buttons = w.findAll('button')
    await buttons.find((b) => b.text() === 'Disable')!.trigger('click')
    expect(setScheduleEnabled).toHaveBeenCalledWith('s1', false)
    await flushPromises()
    await w.findAll('button').find((b) => b.text() === 'Delete')!.trigger('click')
    expect(removeSchedule).toHaveBeenCalledWith('s1')
  })

  it('sorts enabled schedules above retired ones', async () => {
    listSchedules.mockResolvedValue([
      schedule({ id: 'off', title: 'retired one', enabled: false, nextDueAt: 0 }),
      schedule({ id: 'on', title: 'live one', enabled: true, nextDueAt: Date.now() + HOUR })
    ])
    const w = mountModal()
    await flushPromises()
    const titles = w.findAll('.sched__title').map((n) => n.text())
    expect(titles).toEqual(['live one', 'retired one'])
  })

  it('survives a bridge that fails rather than rendering nothing', async () => {
    listSchedules.mockRejectedValue(new Error('ipc down'))
    const w = mountModal()
    await flushPromises()
    expect(w.text()).toContain('Nothing scheduled')
  })
})

describe('SchedulesModal — creating one', () => {
  async function openForm() {
    const w = mountModal()
    await flushPromises()
    await w.findAll('button').find((b) => b.text() === 'New schedule…')!.trigger('click')
    return w
  }

  it('creates a daily conversation schedule with the selected session', async () => {
    const w = await openForm()
    await w.find('textarea').setValue('continue')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(createSchedule).toHaveBeenCalledTimes(1)
    const arg = createSchedule.mock.calls[0][0]
    expect(arg.target).toEqual({ kind: 'conversation', conversationId: 'c1' })
    expect(arg.trigger.kind).toBe('daily')
    expect(arg.prompt).toBe('continue')
  })

  it('refuses an empty prompt in the form instead of creating anything', async () => {
    const w = await openForm()
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(createSchedule).not.toHaveBeenCalled()
    expect(w.text()).toContain('Give it a prompt to deliver.')
  })

  it('refuses a launch with no folder', async () => {
    const w = await openForm()
    await w.find('select').setValue('launch')
    await w.find('textarea').setValue('do the thing')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(createSchedule).not.toHaveBeenCalled()
    expect(w.text()).toContain('folder')
  })

  it('spells out what YOLO mode means where it is chosen', async () => {
    // An unattended auto-executing run on a timer is the highest-consequence
    // thing this form makes; the checkbox must say so, not just say "YOLO".
    const w = await openForm()
    await w.find('select').setValue('launch')
    expect(w.text()).toContain('auto-executes and opens a PR')
  })

  it('fills the folder from the native picker', async () => {
    const w = await openForm()
    await w.find('select').setValue('launch')
    await w.findAll('button').find((b) => b.text() === 'Browse…')!.trigger('click')
    await flushPromises()
    expect((w.find('input[type=text]').element as HTMLInputElement).value).toBe('/picked/repo')
  })
})
