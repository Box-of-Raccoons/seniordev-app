import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { SpawnResult } from '../../../shared/ipc'

// Lightweight xterm stubs: jsdom can't render a real Terminal, and we only need
// to observe write/dispose/paste/focus. Spies are module-level so every instance
// shares them; `selection` drives hasSelection/getSelection per test.
const writeSpy = vi.fn()
const disposeSpy = vi.fn()
const pasteSpy = vi.fn()
const focusSpy = vi.fn()
const clearSelectionSpy = vi.fn()
let selection = ''
// The clipboard key policy is wired through attachCustomKeyEventHandler, so the
// tests grab the handler the component installs and drive it directly.
let keyHandler: ((e: KeyboardEvent) => boolean) | null = null
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    loadAddon(): void {}
    open(): void {}
    onData(): void {}
    attachCustomKeyEventHandler(fn: (e: KeyboardEvent) => boolean): void { keyHandler = fn }
    hasSelection(): boolean { return selection !== '' }
    getSelection(): string { return selection }
    clearSelection = clearSelectionSpy
    paste = pasteSpy
    focus = focusSpy
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
  pasteSpy.mockClear()
  focusSpy.mockClear()
  clearSelectionSpy.mockClear()
  selection = ''
  keyHandler = null
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
    sendStatusActive: vi.fn(),
    sendStatusSettled: vi.fn(),
    clipboardReadText: vi.fn(async () => ''),
    clipboardWriteText: vi.fn(),
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

// A synthetic keydown for the custom handler: only the fields the policy reads,
// plus the preventDefault spy the double-paste guard depends on.
function keydown(over: Partial<KeyboardEvent> = {}): KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> } {
  return {
    type: 'keydown',
    key: 'v',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    ...over
  } as unknown as KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> }
}

async function mountLive(props: Record<string, unknown> = {}): Promise<ReturnType<typeof mount>> {
  const w = mount(TerminalView, { props: { id: 't1', ticketKey: null, ...props } })
  await flushPromises()
  resolveSpawn({ ok: true })
  await flushPromises()
  return w
}

describe('TerminalView clipboard keys', () => {
  it('pastes exactly once: our handler pastes and prevents the browser default', async () => {
    ;(window as unknown as { api: { clipboardReadText: unknown } }).api.clipboardReadText = vi.fn(async () => 'hello')
    await mountLive()

    const e = keydown({ metaKey: true, key: 'v' })
    // Returning false only stops xterm's own key handling. Without preventDefault
    // the browser still fires a `paste` event on xterm's textarea, and xterm's
    // handlePasteEvent writes it to the pty a second time.
    expect(keyHandler?.(e)).toBe(false)
    expect(e.preventDefault).toHaveBeenCalledTimes(1)

    await flushPromises()
    expect(pasteSpy).toHaveBeenCalledTimes(1)
    expect(pasteSpy).toHaveBeenCalledWith('hello')
  })

  it('copies the selection and prevents the default copy from blanking the clipboard', async () => {
    await mountLive()
    selection = 'picked text'

    const e = keydown({ metaKey: true, key: 'c' })
    expect(keyHandler?.(e)).toBe(false)
    // copySelection clears the selection, so a native copy event firing afterwards
    // would write an empty string over what we just put on the clipboard.
    expect(e.preventDefault).toHaveBeenCalledTimes(1)
    expect(window.api.clipboardWriteText).toHaveBeenCalledWith('picked text')
    expect(clearSelectionSpy).toHaveBeenCalledTimes(1)
  })

  it('lets a bare Ctrl+C through untouched when nothing is selected (SIGINT)', async () => {
    await mountLive()

    const e = keydown({ ctrlKey: true, key: 'c' })
    expect(keyHandler?.(e)).toBe(true)
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(window.api.clipboardWriteText).not.toHaveBeenCalled()
  })

  it('leaves ordinary keys alone', async () => {
    await mountLive()

    const e = keydown({ key: 'a' })
    expect(keyHandler?.(e)).toBe(true)
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(pasteSpy).not.toHaveBeenCalled()
  })
})
