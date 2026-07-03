import { describe, it, expect, vi, beforeEach } from 'vitest'

const handleMap = new Map<string, (...a: unknown[]) => unknown>()
const onMap = new Map<string, (...a: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (...a: unknown[]) => unknown) => handleMap.set(ch, fn),
    on: (ch: string, fn: (...a: unknown[]) => unknown) => onMap.set(ch, fn)
  }
}))

import { registerTerminalIpc } from './terminal-handlers'
import type { PtyProcess, PtySpawner } from '../terminal/manager'
import type { Config } from '../config/schema'
import type { Ticket } from '../../shared/types'
const ticket: Ticket = { key: 'PROJ-1', type: 'Bug', status: 'Open', summary: 's', descriptionAdf: null, acceptanceCriteria: null, comments: [], url: 'u' }
const deps = { getTicket: async () => ticket, prompts: [{ name: 'p', description: '', body: 'Do {{ticket.key}}' }] }

const cfg = {
  defaultTool: 'claude',
  ticketContext: 'both',
  cliTools: { claude: { command: 'claude', interactiveArgs: [], promptDelivery: 'stdin' } },
  defaultForge: 'github',
  forges: { github: { prCommand: 'gh pr create', term: 'PR', urlPattern: 'x' } },
  repos: []
} as unknown as Config

function fakePty() {
  let dataCb: (d: string) => void = () => {}
  let exitCb: (e: { exitCode: number }) => void = () => {}
  return {
    onData: (cb: (d: string) => void) => { dataCb = cb },
    onExit: (cb: (e: { exitCode: number }) => void) => { exitCb = cb },
    write: vi.fn(), resize: vi.fn(), kill: vi.fn(),
    emitData: (d: string) => dataCb(d),
    emitExit: (c: number) => exitCb({ exitCode: c })
  }
}

beforeEach(() => { handleMap.clear(); onMap.clear() })

describe('registerTerminalIpc', () => {
  it('spawns on pty:spawn and forwards data to the sender with the id', async () => {
    const pty = fakePty()
    const spawner: PtySpawner = () => pty as unknown as PtyProcess
    const send = vi.fn()
    registerTerminalIpc(cfg, () => ({ send } as unknown as Electron.WebContents), spawner, deps)

    const res = await handleMap.get('pty:spawn')!({}, { id: 'a', cols: 80, rows: 24 })
    expect(res).toEqual({ ok: true })
    pty.emitData('out')
    expect(send).toHaveBeenCalledWith('pty:data', { id: 'a', data: 'out' })
  })

  it('returns {ok:false} when the launch cannot be built', async () => {
    registerTerminalIpc(cfg, () => undefined, (() => fakePty() as unknown as PtyProcess), deps)
    const res = await handleMap.get('pty:spawn')!({}, { id: 'b', tool: 'ghost', cols: 80, rows: 24 })
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/unknown cli tool/i) })
  })

  it('routes pty:write to the manager', async () => {
    const pty = fakePty()
    registerTerminalIpc(cfg, () => undefined, () => pty as unknown as PtyProcess, deps)
    await handleMap.get('pty:spawn')!({}, { id: 'a', cols: 80, rows: 24 })
    onMap.get('pty:write')!({}, 'a', 'typed')
    expect(pty.write).toHaveBeenCalledWith('typed')
  })

  it('delivers the stdin prompt only after boot output settles, Enter as a separate write', async () => {
    vi.useFakeTimers()
    const pty = fakePty()
    registerTerminalIpc(cfg, () => undefined, () => pty as unknown as PtyProcess, deps)
    const res = await handleMap.get('pty:spawn')!({}, { id: 'a', ticketKey: 'PROJ-1', prompt: { name: 'p' }, cols: 80, rows: 24 })
    expect(res).toEqual({ ok: true })
    // Boot screen still streaming — nothing may be written yet.
    pty.emitData('booting…')
    await vi.advanceTimersByTimeAsync(400)
    pty.emitData('welcome screen')
    await vi.advanceTimersByTimeAsync(400)
    expect(pty.write).not.toHaveBeenCalled()
    // Output quiet past the threshold → prompt goes out (no ESC framing).
    await vi.advanceTimersByTimeAsync(500)
    expect(pty.write).toHaveBeenNthCalledWith(1, 'Do PROJ-1')
    // Enter follows as its own keystroke a beat later.
    await vi.advanceTimersByTimeAsync(300)
    expect(pty.write).toHaveBeenNthCalledWith(2, '\r')
    // Guard the regression: no write may contain an ESC (it acts as the Escape key).
    for (const call of pty.write.mock.calls) expect(call[0]).not.toContain('\x1b')
    vi.useRealTimers()
  })

  it('falls back to sending the prompt after the max wait when the CLI prints nothing', async () => {
    vi.useFakeTimers()
    const pty = fakePty()
    registerTerminalIpc(cfg, () => undefined, () => pty as unknown as PtyProcess, deps)
    await handleMap.get('pty:spawn')!({}, { id: 'a', ticketKey: 'PROJ-1', prompt: { name: 'p' }, cols: 80, rows: 24 })
    await vi.advanceTimersByTimeAsync(14000)
    expect(pty.write).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1500)
    expect(pty.write).toHaveBeenNthCalledWith(1, 'Do PROJ-1')
    await vi.advanceTimersByTimeAsync(300)
    expect(pty.write).toHaveBeenNthCalledWith(2, '\r')
    vi.useRealTimers()
  })
})
