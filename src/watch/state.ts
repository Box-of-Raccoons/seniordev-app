import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type DispatchOutcome = 'spawned' | 'failed'
export interface DispatchRecord { at: string; outcome: DispatchOutcome }
export interface WatchStateData {
  autoMode?: boolean
  dispatched: Record<string, DispatchRecord>
}

// Local dedup + runtime autoMode. The state file lives next to config.yaml and
// is the belt to the status-transition suspenders: even if a transition fails or
// is misconfigured, a recorded key is not re-dispatched.
export class WatchState {
  private data: WatchStateData = { dispatched: {} }

  constructor(private readonly path: string) {
    if (existsSync(this.path)) {
      try {
        const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<WatchStateData>
        this.data = { autoMode: parsed.autoMode, dispatched: parsed.dispatched ?? {} }
      } catch {
        // Corrupt file → start clean rather than crash the tray on boot.
        this.data = { dispatched: {} }
      }
    }
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
    renameSync(tmp, this.path)
  }

  has(key: string): boolean {
    return key in this.data.dispatched
  }

  record(key: string, outcome: DispatchOutcome, at: string): void {
    this.data.dispatched[key] = { at, outcome }
    this.save()
  }

  clear(key: string): void {
    delete this.data.dispatched[key]
    this.save()
  }

  getAutoMode(): boolean | undefined {
    return this.data.autoMode
  }

  setAutoMode(v: boolean): void {
    this.data.autoMode = v
    this.save()
  }
}
