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
  ticketContext: 'inject',
  cliTools: { claude: { command: 'claude', interactiveArgs: [], yoloArgs: [], promptDelivery: 'stdin' } },
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

  it('expands a named prompt and writes it to stdin (bracketed-paste framed) after the boot delay', async () => {
    vi.useFakeTimers()
    const pty = fakePty()
    registerTerminalIpc(cfg, () => undefined, () => pty as unknown as PtyProcess, deps)
    const res = await handleMap.get('pty:spawn')!({}, { id: 'a', ticketKey: 'PROJ-1', prompt: { name: 'p' }, cols: 80, rows: 24 })
    expect(res).toEqual({ ok: true })
    // Nothing written before the boot delay elapses.
    expect(pty.write).not.toHaveBeenCalled()
    await vi.runAllTimersAsync()
    // Bracketed-paste framing: ESC[200~ … ESC[201~ then a submitting CR.
    expect(pty.write).toHaveBeenCalledWith('\x1b[200~Do PROJ-1\x1b[201~\r')
    vi.useRealTimers()
  })

  it('emits pty:pr when a yolo session prints a PR url', async () => {
    const pty = fakePty()
    const send = vi.fn()
    const yoloCfg = { ...cfg, forges: { github: { prCommand: 'gh pr create', term: 'PR', urlPattern: 'https://github\\.com/[^/\\s]+/[^/\\s]+/pull/\\d+' } } } as unknown as Config
    registerTerminalIpc(yoloCfg, () => ({ send } as unknown as Electron.WebContents), () => pty as unknown as PtyProcess, deps)
    await handleMap.get('pty:spawn')!({}, { id: 'y', yolo: true, cols: 80, rows: 24 })
    pty.emitData('opened https://github.com/o/r/pull/5\n')
    expect(send).toHaveBeenCalledWith('pty:pr', { id: 'y', url: 'https://github.com/o/r/pull/5', term: 'PR' })
  })
})
