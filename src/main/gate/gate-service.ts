import type { Config } from '../config/schema'
import type { GateResultEvent, GateRunningEvent, StatusUpdateEvent } from '../../shared/ipc'
import { gateCommandFor } from './gate-config'
import { resolveGate, type GateRun, type GateResult } from './gate-result'

// Supervision slice 2. Runs a project's own gate when one of its sessions falls
// quiet, and reports pass/fail on the tab.
//
// Pure and fully injectable, like status-hub.ts: the command runner and the two
// event sinks are supplied, so this never imports Electron and is testable with
// no child process.

export type GateCommandRunner = (command: string, cwd: string, timeoutMs: number) => Promise<GateRun>

export interface GateServiceDeps {
  // Nullable because the config store has none until it loads. No config means
  // no gate: the app must never execute a command it cannot read the rules for.
  getConfig: () => Config | null
  runner: GateCommandRunner
  onResult: (e: GateResultEvent) => void
  onRunning: (e: GateRunningEvent) => void
}

export interface GateService {
  /** A pty tab started in `cwd`; it becomes eligible for a gate. */
  track(ptyId: string, cwd: string): void
  /** The tab closed: drop it, and drop any run still queued for it. */
  untrack(ptyId: string): void
  /** React to a status change. Resolves once any gate this triggered has finished. */
  onStatus(ev: StatusUpdateEvent): Promise<void>
  /** Run the gate for a tab now, regardless of status. Resolves when it finishes. */
  runNow(ptyId: string): Promise<void>
  /** The last run's full output for a tab, or null. */
  outputFor(ptyId: string): string | null
}

export function createGateService(deps: GateServiceDeps): GateService {
  const tabs = new Map<string, { cwd: string; output: string | null }>()
  // Gates run ONE AT A TIME. Four agents settling together would otherwise
  // launch four full test suites at once, which thrashes the machine and makes
  // every one of them slower and less reliable (shared ports, shared test DBs).
  const queued = new Set<string>()
  let chain: Promise<void> = Promise.resolve()

  function enqueue(ptyId: string): Promise<void> {
    // Already waiting: a tab that settles twice before its turn gets one run,
    // not two.
    if (queued.has(ptyId)) return chain
    queued.add(ptyId)
    // The .catch is load-bearing, not decoration. `execute` reports through
    // sinks that reach Electron's webContents, which THROWS if the window was
    // destroyed mid-run. Without this, one such rejection poisons `chain`
    // permanently: every later `.then` is skipped, so no tab's gate ever runs
    // again and the skipped entries stay in `queued` forever, making even a
    // manual runNow a no-op. Swallowing here keeps the queue alive.
    chain = chain.then(() => execute(ptyId)).catch(() => {})
    return chain
  }

  async function execute(ptyId: string): Promise<void> {
    queued.delete(ptyId)
    const tab = tabs.get(ptyId)
    // Closed while it sat in the queue: there is no tab left to report on.
    if (!tab) return

    const config = deps.getConfig()
    if (!config) return
    const command = gateCommandFor(config, tab.cwd)
    if (!command) return
    const timeoutMs = config.gateTimeoutMs

    deps.onRunning({ ptyId, command })

    let result: GateResult
    try {
      result = resolveGate(await deps.runner(command, tab.cwd, timeoutMs))
    } catch (e) {
      // A runner that throws is a broken harness, not failing code. Reporting it
      // as `fail` would blame the work; it must also never take main down.
      const message = e instanceof Error ? e.message : String(e)
      result = { outcome: 'error', code: null, summary: message, output: message, durationMs: 0 }
    }

    // The tab may have closed while the gate ran; keep nothing for it.
    const still = tabs.get(ptyId)
    if (!still) return
    still.output = result.output

    deps.onResult({
      ptyId,
      outcome: result.outcome,
      summary: result.summary,
      durationMs: result.durationMs,
      command
    })
  }

  return {
    track(ptyId, cwd) {
      tabs.set(ptyId, { cwd, output: null })
    },
    untrack(ptyId) {
      tabs.delete(ptyId)
      queued.delete(ptyId)
    },
    onStatus(ev) {
      // `idle` is the one moment worth gating: the session went quiet and main's
      // buffer scan found no prompt. `needsYou` is the agent waiting on a human
      // mid-task, where the tree is half-edited and a gate would report a red
      // that says nothing about finished work.
      if (ev.status !== 'idle') return Promise.resolve()
      if (!tabs.has(ev.id)) return Promise.resolve()
      return enqueue(ev.id)
    },
    runNow(ptyId) {
      if (!tabs.has(ptyId)) return Promise.resolve()
      return enqueue(ptyId)
    },
    outputFor(ptyId) {
      return tabs.get(ptyId)?.output ?? null
    }
  }
}
