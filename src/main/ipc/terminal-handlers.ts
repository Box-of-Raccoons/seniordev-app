import { ipcMain } from 'electron'
import { requireConfig, type ConfigSource } from '../config/store'
import { TerminalManager, type PtySpawner } from '../terminal/manager'
import { buildInteractiveLaunch } from '../terminal/session'
import type { ResolvedCommand } from '../terminal/resolve-command'
import { TERM, type SpawnTerminalRequest, type SpawnResult } from '../../shared/ipc'
import { resolveExpandedPrompt } from './resolve-prompt'

export interface TerminalDeps {
  source: ConfigSource
  resolveCommand?: (command: string) => ResolvedCommand | undefined
}

// Stdin prompt delivery must wait for the CLI's TUI to be READY, not a fixed
// delay: claude takes ~2s to boot, ConPTY buffers anything written earlier and
// hands it to the TUI as ONE chunk, and ink then treats the bundled prompt+\r
// as a paste — the \r becomes pasted text instead of a submit (verified against
// claude 2.1.191: fixed 800ms delay → prompt stuck in composer; readiness
// detection → submitted and answered). Readiness = the session has produced
// output and then gone quiet for QUIET_MS (boot screen finished rendering).
const QUIET_MS = 700
const POLL_MS = 100
// Enter goes as its own keystroke a beat after the prompt text.
const SUBMIT_DELAY_MS = 300
// Safety valve: if the CLI never settles (endless spinner), send anyway.
const MAX_WAIT_MS = 15000

export function registerTerminalIpc(
  getSender: () => Electron.WebContents | undefined,
  spawner: PtySpawner,
  deps: TerminalDeps
): TerminalManager {
  // Per-session prompt-delivery state: output activity + the live timer handle.
  const pendingPrompts = new Map<string, { sawData: boolean; lastData: number }>()
  const promptTimers = new Map<string, NodeJS.Timeout>()

  function cancelPendingPrompt(id: string): void {
    const t = promptTimers.get(id)
    if (t) clearTimeout(t) // clears intervals too — same handle type
    promptTimers.delete(id)
    pendingPrompts.delete(id)
  }

  const manager = new TerminalManager(spawner, {
    onData: (id, data) => {
      getSender()?.send(TERM.data, { id, data })
      const pend = pendingPrompts.get(id)
      if (pend) { pend.sawData = true; pend.lastData = Date.now() }
    },
    onExit: (id, exitCode) => {
      getSender()?.send(TERM.exit, { id, exitCode })
      cancelPendingPrompt(id)
    }
  })

  function deliverPromptWhenReady(id: string, prompt: string): void {
    const started = Date.now()
    pendingPrompts.set(id, { sawData: false, lastData: 0 })
    const iv = setInterval(() => {
      const pend = pendingPrompts.get(id)
      if (!pend) { clearInterval(iv); return }
      const settled = pend.sawData && Date.now() - pend.lastData >= QUIET_MS
      if (!settled && Date.now() - started < MAX_WAIT_MS) return
      clearInterval(iv)
      pendingPrompts.delete(id)
      manager.write(id, prompt)
      promptTimers.set(id, setTimeout(() => {
        manager.write(id, '\r')
        promptTimers.delete(id)
      }, SUBMIT_DELAY_MS))
    }, POLL_MS)
    promptTimers.set(id, iv)
  }

  ipcMain.handle(TERM.spawn, async (_e, req: SpawnTerminalRequest): Promise<SpawnResult> => {
    try {
      const config = requireConfig(deps.source)
      const expanded = await resolveExpandedPrompt(config, deps.source, req)
      const launch = buildInteractiveLaunch(config, { ...req, model: expanded?.model }, expanded?.prompt, deps.resolveCommand)
      manager.spawn(req.id, {
        file: launch.file,
        args: launch.args,
        cwd: launch.cwd,
        cols: req.cols,
        rows: req.rows,
        resolved: launch.resolved
      })
      // NOTE: no bracketed-paste framing here — the raw ESC of \x1b[200~ registers
      // as the Escape key in these TUIs (clears the composer / exits dialogs).
      if (launch.stdinPrompt) deliverPromptWhenReady(req.id, launch.stdinPrompt)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.on(TERM.write, (_e, id: string, data: string) => manager.write(id, data))
  ipcMain.on(TERM.resize, (_e, id: string, cols: number, rows: number) => manager.resize(id, cols, rows))
  ipcMain.on(TERM.kill, (_e, id: string) => {
    cancelPendingPrompt(id)
    manager.kill(id)
  })

  return manager
}
