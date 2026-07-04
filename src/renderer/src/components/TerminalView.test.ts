import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { SpawnResult } from '../../../shared/ipc'

// Lightweight xterm stubs: jsdom can't render a real Terminal, and we only need
// to observe write/dispose. Spies are module-level so every instance shares them.
const writeSpy = vi.fn()
const disposeSpy = vi.fn()
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    loadAddon(): void {}
    open(): void {}
    onData(): void {}
    write = writeSpy
    dispose = disposeSpy
  }
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit(): void {} } }))

import TerminalView from './TerminalView.vue'

const observeSpy = vi.fn()
const disconnectSpy = vi.fn()
let resolveSpawn: (r: SpawnResult) => void

beforeEach(() => {
  writeSpy.mockClear()
  disposeSpy.mockClear()
  observeSpy.mockClear()
  disconnectSpy.mockClear()
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe = observeSpy
    disconnect = disconnectSpy
  }
  ;(window as unknown as { api: unknown }).api = {
    writeTerminal: vi.fn(),
    resizeTerminal: vi.fn(),
    killTerminal: vi.fn(),
    onTerminalData: vi.fn(() => () => {}),
    onTerminalExit: vi.fn(() => () => {}),
    spawnTerminal: vi.fn(() => new Promise<SpawnResult>((res) => { resolveSpawn = res }))
  }
})

describe('TerminalView unmount safety (SD-9 B2)', () => {
  it('bails after the spawn round-trip if the tab closed mid-flight', async () => {
    const w = mount(TerminalView, { props: { id: 't1', ticketKey: null } })
    await flushPromises() // onMounted suspended on the pending spawnTerminal
    w.unmount() // disposes the terminal while spawn is still in flight
    expect(disposeSpy).toHaveBeenCalledTimes(1)

    // The spawn resolves ok:false AFTER unmount — without the guard this writes to
    // a disposed terminal and wires an observer on a gone host.
    resolveSpawn({ ok: false, error: 'nope' })
    await flushPromises()
    expect(writeSpy).not.toHaveBeenCalled()
    expect(observeSpy).not.toHaveBeenCalled()
  })

  it('wires the resize observer normally when still mounted', async () => {
    mount(TerminalView, { props: { id: 't2', ticketKey: null } })
    await flushPromises()
    resolveSpawn({ ok: true })
    await flushPromises()
    expect(observeSpy).toHaveBeenCalledTimes(1)
    expect(writeSpy).not.toHaveBeenCalled() // ok:true → no failure banner
  })
})
