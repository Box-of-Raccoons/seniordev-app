import type { ResolvedCommand } from './resolve-command'

export interface PtyProcess {
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number }) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

export interface SpawnOptions {
  file: string
  args: string[]
  cwd: string
  cols: number
  rows: number
  resolved?: ResolvedCommand
}

export type PtySpawner = (opts: SpawnOptions) => PtyProcess

export interface TerminalManagerCallbacks {
  onData: (id: string, data: string) => void
  onExit: (id: string, exitCode: number) => void
}

export class TerminalManager {
  private readonly sessions = new Map<string, PtyProcess>()

  constructor(
    private readonly spawnPty: PtySpawner,
    private readonly cb: TerminalManagerCallbacks
  ) {}

  spawn(id: string, opts: SpawnOptions): void {
    if (this.sessions.has(id)) throw new Error(`Terminal ${id} already exists`)
    const pty = this.spawnPty(opts)
    pty.onData((data) => this.cb.onData(id, data))
    pty.onExit(({ exitCode }) => {
      this.cb.onExit(id, exitCode)
      this.sessions.delete(id)
    })
    this.sessions.set(id, pty)
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.resize(cols, rows)
  }

  kill(id: string): void {
    const pty = this.sessions.get(id)
    if (pty) {
      pty.kill()
      this.sessions.delete(id)
    }
  }

  killAll(): void {
    for (const pty of this.sessions.values()) pty.kill()
    this.sessions.clear()
  }

  has(id: string): boolean {
    return this.sessions.has(id)
  }

  get size(): number {
    return this.sessions.size
  }
}
