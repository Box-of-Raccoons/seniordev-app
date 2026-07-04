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
    launch: vi.fn(),
    state: new WatchState(path),
    notify: (n) => notes.push(n),
    isAuto: () => true,
    now: () => '2026-07-03T00:00:00.000Z',
    ...over
  }
  return { deps, notes }
}

const settle = (): Promise<void> => new Promise((r) => setImmediate(r))

describe('WatchDispatcher', () => {
  it('auto: launches the app, records spawned, transitions, notifies', async () => {
    const { deps, notes } = makeDeps()
    await new WatchDispatcher(deps).poll()
    await settle()
    expect(deps.launch).toHaveBeenCalledWith(expect.objectContaining({ key: 'SD-1' }))
    expect(deps.transition).toHaveBeenCalledWith('SD-1', 'In Progress')
    expect(deps.state.has('SD-1')).toBe(true)
    expect(notes.some((n) => n.title.startsWith('Dispatched SD-1'))).toBe(true)
  })

  it('no matching repo: notify + skip, no launch, not recorded', async () => {
    const { deps, notes } = makeDeps({ search: async () => [ticket('ZZ-9')] })
    await new WatchDispatcher(deps).poll()
    await settle()
    expect(deps.launch).not.toHaveBeenCalled()
    expect(deps.state.has('ZZ-9')).toBe(false)
    expect(notes.some((n) => n.title.includes('no repo'))).toBe(true)
  })

  it('dedup: an already-recorded key is skipped', async () => {
    const { deps } = makeDeps()
    deps.state.record('SD-1', 'spawned', 'earlier')
    await new WatchDispatcher(deps).poll()
    await settle()
    expect(deps.launch).not.toHaveBeenCalled()
  })

  it('does not re-dispatch the same ticket across polls', async () => {
    const { deps } = makeDeps()
    const d = new WatchDispatcher(deps)
    await d.poll(); await settle()
    await d.poll(); await settle()
    expect(deps.launch).toHaveBeenCalledTimes(1)
  })

  it('approve mode: notifies with onClick, launches only after approve()', async () => {
    const { deps, notes } = makeDeps({ isAuto: () => false })
    const d = new WatchDispatcher(deps)
    await d.poll()
    await settle()
    expect(deps.launch).not.toHaveBeenCalled()
    const note = notes.find((n) => n.ticketKey === 'SD-1' && n.onClick)!
    note.onClick!()
    await settle()
    expect(deps.launch).toHaveBeenCalledTimes(1)
  })

  it('exposes pending approvals for the tray submenu and clears one on approve', async () => {
    const { deps } = makeDeps({ isAuto: () => false })
    const d = new WatchDispatcher(deps)
    await d.poll()
    await settle()
    expect(d.pendingApprovals()).toEqual([{ key: 'SD-1', summary: 'sum SD-1' }])
    d.approve('SD-1')
    await settle()
    expect(d.pendingApprovals()).toEqual([])
    expect(deps.launch).toHaveBeenCalledTimes(1)
  })

  it('search failure: notify, no crash', async () => {
    const { deps, notes } = makeDeps({ search: async () => { throw new Error('boom') } })
    await new WatchDispatcher(deps).poll()
    await settle()
    expect(notes.some((n) => n.title.includes('poll failed'))).toBe(true)
  })

  it('transition failure: still launched, notifies the transition error', async () => {
    const { deps, notes } = makeDeps({ transition: vi.fn(async () => { throw new Error('no workflow') }) })
    await new WatchDispatcher(deps).poll()
    await settle()
    expect(deps.launch).toHaveBeenCalledTimes(1)
    expect(notes.some((n) => n.title.includes('Transition failed'))).toBe(true)
  })

  it('launch throwing is notified, not swallowed', async () => {
    const { deps, notes } = makeDeps({ launch: vi.fn(() => { throw new Error('spawn failed') }) })
    await new WatchDispatcher(deps).poll()
    await settle()
    expect(notes.some((n) => n.body.includes('spawn failed'))).toBe(true)
  })

  it('launch rejecting (async spawn error) is notified, not recorded, and re-dispatches next poll (SD-9 B1)', async () => {
    // First attempt fails to spawn (ENOENT), second succeeds — mirrors an AV/EPERM
    // hiccup clearing on retry. The failed attempt must strand nothing.
    const launch = vi
      .fn()
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValueOnce(undefined)
    const { deps, notes } = makeDeps({ launch })
    const d = new WatchDispatcher(deps)
    await d.poll()
    await settle()
    expect(notes.some((n) => n.title.includes('Launch failed'))).toBe(true)
    expect(deps.state.has('SD-1')).toBe(false) // not recorded → still in the query
    expect(deps.transition).not.toHaveBeenCalled() // never transitioned on failure

    await d.poll()
    await settle()
    expect(launch).toHaveBeenCalledTimes(2) // re-dispatched on the next poll
    expect(deps.state.has('SD-1')).toBe(true) // the successful retry committed
  })
})
