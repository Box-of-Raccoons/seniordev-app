import type { ResolvedCommand } from '../terminal/resolve-command'
import { PrCollector, type ForgePattern } from '../terminal/pr-detector'
import { LineBuffer, type ParsedEvent, type StreamParser } from './parser'

export interface HeadlessChild {
  onStdout(cb: (chunk: string) => void): void
  onStderr(cb: (chunk: string) => void): void
  onExit(cb: (exitCode: number) => void): void
  writeAndCloseStdin(data: string): void
  kill(): void
}

export type HeadlessSpawner = (opts: {
  file: string
  args: string[]
  cwd: string
  resolved?: ResolvedCommand
}) => HeadlessChild

export interface YoloCallbacks {
  onLog(id: string, text: string): void
  onPr(id: string, url: string, term: string): void
  onExit(id: string, e: { exitCode: number; sessionId?: string; prUrls: string[] }): void
}

export class YoloRunner {
  private readonly runs = new Map<string, HeadlessChild>()

  constructor(
    private readonly spawn: HeadlessSpawner,
    private readonly cb: YoloCallbacks
  ) {}

  start(
    id: string,
    opts: {
      file: string
      args: string[]
      cwd: string
      prompt: string
      parser: StreamParser
      patterns: ForgePattern[]
      resolved?: ResolvedCommand
    }
  ): void {
    if (this.runs.has(id)) throw new Error(`YOLO run ${id} already exists`)
    const child = this.spawn({ file: opts.file, args: opts.args, cwd: opts.cwd, resolved: opts.resolved })
    let sessionId: string | undefined
    const collector = new PrCollector(opts.patterns)
    const stderrLines = new LineBuffer()

    const emit = (events: ParsedEvent[]): void => {
      for (const ev of events) {
        if (ev.kind === 'session') {
          sessionId ??= ev.id
        } else {
          this.cb.onLog(id, ev.text)
          for (const hit of collector.feed(ev.text + '\n')) this.cb.onPr(id, hit.url, hit.term)
        }
      }
    }

    child.onStdout((chunk) => emit(opts.parser.feed(chunk)))
    child.onStderr((chunk) => {
      for (const line of stderrLines.push(chunk)) if (line.trim()) this.cb.onLog(id, line)
    })
    child.onExit((exitCode) => {
      emit(opts.parser.flush())
      for (const line of stderrLines.flush()) if (line.trim()) this.cb.onLog(id, line)
      // Guard against id reuse: after kill()+start() with the same id, the old
      // child's late 'close' must not evict the NEW child from the map.
      if (this.runs.get(id) === child) this.runs.delete(id)
      this.cb.onExit(id, { exitCode, sessionId, prUrls: collector.urls })
    })
    child.writeAndCloseStdin(opts.prompt)
    this.runs.set(id, child)
  }

  kill(id: string): void {
    this.runs.get(id)?.kill()
    this.runs.delete(id)
  }

  killAll(): void {
    for (const child of this.runs.values()) child.kill()
    this.runs.clear()
  }

  has(id: string): boolean {
    return this.runs.has(id)
  }
}
