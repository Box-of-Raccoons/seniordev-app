import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WatchDispatcher, type DispatcherDeps, type WatchNotification } from './dispatcher'
import { WatchState } from './state'
import { ConfigSchema, type Config } from '../main/config/schema'
import type { Ticket } from '../shared/types'

const config: Config = ConfigSchema.parse({
  jira: { baseUrl: 'https://x.atlassian.net', email: 'a@b.co', apiToken: 't' },
  repos: [{ key: 'SD', path: 'C:/repos/sd' }],
  watch: { enabled: true, transitionOnDispatch: 'In Progress' }
})
const ticket = (key: string): Ticket => ({ key, type: 'Bug', status: 'To Do', summary: `sum ${key}`, descriptionAdf: null, acceptanceCriteria: null, comments: [], url: 'u' })

function makeDeps(over: Partial<DispatcherDeps> = {}): { deps: DispatcherDeps; notes: WatchNotification[] } {
  const notes: WatchNotification[] = []
  const path = join(mkdtempSync(join(tmpdir(), 'sd-disp-')), 'state.json')
  const deps: DispatcherDeps = {
    config: () => config,
    search: async () => [ticket('SD-1')],
    transition: vi.fn(async () => {}),
    classify: vi.fn(async () => ({ ok: true as const, prompt: 'fix-bug' })),
    spawn: vi.fn(async () => ({ exitCode: 0, prUrls: ['https://github.com/o/r/pull/1'] })),
    state: new WatchState(path),
    notify: (n) => notes.push(n),
    isAuto: () => true,
    now: () => '2026-07-03T00:00:00.000Z',
    ...over
  }
  return { deps, notes }
}

const settle = () => new Promise((r) => setImmediate(r))

describe('WatchDispatcher', () => {
  it('auto: classify→spawn→record+transition→notify done', async () => {
    const { deps, notes } = makeDeps()
    const d = new WatchDispatcher(deps)
    await d.poll()
    await settle()
    expect(deps.classify).toHaveBeenCalledTimes(1)
    expect(deps.spawn).toHaveBeenCalledWith(expect.objectContaining({ key: 'SD-1' }), 'C:/repos/sd', 'fix-bug')
    expect(deps.transition).toHaveBeenCalledWith('SD-1', 'In Progress')
    expect(deps.state.has('SD-1')).toBe(true)
    expect(notes.some((n) => n.title.startsWith('Done'))).toBe(true)
  })

  it('no matching repo: notify + skip, no classify, not recorded', async () => {
    const { deps, notes } = makeDeps({ search: async () => [ticket('ZZ-9')] })
    await new WatchDispatcher(deps).poll()
    await settle()
    expect(deps.classify).not.toHaveBeenCalled()
    expect(deps.state.has('ZZ-9')).toBe(false)
    expect(notes.some((n) => n.title.includes('no repo'))).toBe(true)
  })

  it('classify failure: record failed, notify, NO transition, NO spawn', async () => {
    const { deps, notes } = makeDeps({ classify: vi.fn(async () => ({ ok: false as const, reason: 'no fit' })) })
    await new WatchDispatcher(deps).poll()
    await settle()
    expect(deps.spawn).not.toHaveBeenCalled()
    expect(deps.transition).not.toHaveBeenCalled()
    expect(deps.state.has('SD-1')).toBe(true)
    expect(notes.some((n) => n.body === 'no fit')).toBe(true)
  })

  it('dedup: an already-recorded key is skipped', async () => {
    const { deps } = makeDeps()
    deps.state.record('SD-1', 'spawned', 'earlier')
    await new WatchDispatcher(deps).poll()
    await settle()
    expect(deps.classify).not.toHaveBeenCalled()
  })

  it('approve mode: notifies with onClick, runs only after approve()', async () => {
    const { deps, notes } = makeDeps({ isAuto: () => false })
    const d = new WatchDispatcher(deps)
    await d.poll()
    await settle()
    expect(deps.classify).not.toHaveBeenCalled()
    const note = notes.find((n) => n.ticketKey === 'SD-1' && n.onClick)!
    note.onClick!()
    await settle()
    expect(deps.classify).toHaveBeenCalledTimes(1)
  })

  it('search failure: notify, no crash', async () => {
    const { deps, notes } = makeDeps({ search: async () => { throw new Error('boom') } })
    await new WatchDispatcher(deps).poll()
    await settle()
    expect(notes.some((n) => n.title.includes('poll failed'))).toBe(true)
  })

  it('transition failure: still spawns, notifies the transition error', async () => {
    const { deps, notes } = makeDeps({ transition: vi.fn(async () => { throw new Error('no workflow') }) })
    await new WatchDispatcher(deps).poll()
    await settle()
    expect(deps.spawn).toHaveBeenCalledTimes(1)
    expect(notes.some((n) => n.title.includes('Transition failed'))).toBe(true)
  })
})
