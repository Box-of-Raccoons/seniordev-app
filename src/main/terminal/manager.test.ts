import { describe, it, expect, vi } from 'vitest'
import { TerminalManager, type PtyProcess, type PtySpawner } from './manager'

function fakePty() {
  let dataCb: (d: string) => void = () => {}
  let exitCb: (e: { exitCode: number }) => void = () => {}
  const pty: PtyProcess & { emitData: (d: string) => void; emitExit: (c: number) => void } = {
    onData: (cb) => { dataCb = cb },
    onExit: (cb) => { exitCb = cb },
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    emitData: (d) => dataCb(d),
    emitExit: (c) => exitCb({ exitCode: c })
  }
  return pty
}

const opts = { file: 'claude', args: [], cwd: '/tmp', cols: 80, rows: 24 }

describe('TerminalManager', () => {
  it('spawns and forwards data with the session id', () => {
    const pty = fakePty()
    const spawner: PtySpawner = () => pty
    const onData = vi.fn()
    const m = new TerminalManager(spawner, { onData, onExit: vi.fn() })
    m.spawn('a', opts)
    pty.emitData('hello')
    expect(onData).toHaveBeenCalledWith('a', 'hello')
    expect(m.has('a')).toBe(true)
  })

  it('removes the session on exit and forwards exit code', () => {
    const pty = fakePty()
    const onExit = vi.fn()
    const m = new TerminalManager(() => pty, { onData: vi.fn(), onExit })
    m.spawn('a', opts)
    pty.emitExit(0)
    expect(onExit).toHaveBeenCalledWith('a', 0)
    expect(m.has('a')).toBe(false)
  })

  it('delegates write/resize/kill to the right session', () => {
    const pty = fakePty()
    const m = new TerminalManager(() => pty, { onData: vi.fn(), onExit: vi.fn() })
    m.spawn('a', opts)
    m.write('a', 'x'); m.resize('a', 100, 40); m.kill('a')
    expect(pty.write).toHaveBeenCalledWith('x')
    expect(pty.resize).toHaveBeenCalledWith(100, 40)
    expect(pty.kill).toHaveBeenCalled()
    expect(m.has('a')).toBe(false)
  })

  it('throws on duplicate id and no-ops write to unknown id', () => {
    const m = new TerminalManager(() => fakePty(), { onData: vi.fn(), onExit: vi.fn() })
    m.spawn('a', opts)
    expect(() => m.spawn('a', opts)).toThrow(/already exists/i)
    expect(() => m.write('ghost', 'x')).not.toThrow()
  })

  it('killAll kills every session', () => {
    const p1 = fakePty(), p2 = fakePty()
    const spawner = vi.fn().mockReturnValueOnce(p1).mockReturnValueOnce(p2)
    const m = new TerminalManager(spawner as unknown as PtySpawner, { onData: vi.fn(), onExit: vi.fn() })
    m.spawn('a', opts); m.spawn('b', opts)
    m.killAll()
    expect(p1.kill).toHaveBeenCalled()
    expect(p2.kill).toHaveBeenCalled()
    expect(m.size).toBe(0)
  })
})
