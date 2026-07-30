import { ipcMain } from 'electron'
import { requireConfig, type ConfigSource } from '../config/store'
import { TerminalManager, type PtySpawner } from '../terminal/manager'
import { buildInteractiveLaunch } from '../terminal/session'
import { resolveShell } from '../terminal/shell'
import type { ResolvedCommand } from '../terminal/resolve-command'
import { TERM, type SpawnTerminalRequest, type SpawnShellRequest, type SpawnResult } from '../../shared/ipc'
import { resolveExpandedPrompt } from './resolve-prompt'
import { createSessionActivity, type SessionActivity } from '../terminal/activity'
import type { StatusHub } from '../terminal/status-hub'
import type { Config } from '../config/schema'

export interface TerminalDeps {
  source: ConfigSource
  resolveCommand?: (command: string) => ResolvedCommand | undefined
  // S1 status: the shared activity tracker (so status and prompt delivery detect
  // quiet from one source) and the hub that turns events into status updates.
  // Optional so existing tests that exercise only prompt delivery need neither.
  activity?: SessionActivity
  statusHub?: StatusHub
}

// A shell tab has no fixed tool, so it is scanned against every tool's approval
// patterns — if a user runs claude or codex by hand, the union still matches
// (plan section 3). Deduped; empty when no config has loaded yet.
function unionApprovalPatterns(config: Config | null): string[] {
  if (!config) return []
  return [...new Set(Object.values(config.cliTools).flatMap((t) => t.approvalPatterns ?? []))]
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
  // Continuous per-session output activity (see terminal/activity.ts). Prompt
  // delivery below registers one-shot watches over it; the status hub watches the
  // same source continuously, so quiet is detected in one place. The hub is
  // handed the SAME instance from index.ts; a bare test falls back to its own.
  const activity = deps.activity ?? createSessionActivity()
  // Canceller for the delivery step currently in flight (a pending quiet watch
  // or the Enter timeout), so a kill/exit can stop it mid-delivery.
  const deliveryCancels = new Map<string, () => void>()

  function cancelPendingPrompt(id: string): void {
    deliveryCancels.get(id)?.()
    deliveryCancels.delete(id)
  }

  const manager = new TerminalManager(spawner, {
    onData: (id, data) => {
      getSender()?.send(TERM.data, { id, data })
      // Feeds prompt delivery's byte-quiet watch only. Status "working" is NOT
      // driven from here: these TUIs repaint every ~600ms, so every byte would
      // pin the tab to working and it could never settle to idle. The renderer
      // reports working from real buffer-CONTENT change instead (STATUS.active).
      activity.data(id)
    },
    onExit: (id, exitCode) => {
      getSender()?.send(TERM.exit, { id, exitCode })
      cancelPendingPrompt(id)
      activity.clear(id)
      deps.statusHub?.exit(id, exitCode)
    }
  })

  // Resolve `then` once the session has produced output and gone quiet for
  // quietMs (or the max-wait safety valve trips). A thin caller over the shared
  // activity tracker: the semantics that make prompt delivery work are unchanged
  // (each call waits for NEW output after it), only the activity data now lives
  // for the whole session instead of just while a prompt is pending.
  function waitForQuiet(id: string, quietMs: number, then: () => void): void {
    const cancel = activity.watch(id, { quietMs, maxWaitMs: MAX_WAIT_MS, pollMs: POLL_MS }, () => {
      deliveryCancels.delete(id)
      then()
    })
    deliveryCancels.set(id, cancel)
  }

  function deliverPromptWhenReady(id: string, prompt: string, bracketedPaste: boolean): void {
    waitForQuiet(id, QUIET_MS, () => {
      // Bracketed paste (ESC[200~ … ESC[201~) tells a TUI that honors it (codex)
      // to take a multi-line prompt as ONE composer block, not submit per line.
      // Only for opted-in tools: the raw ESC would clear claude's composer.
      manager.write(id, bracketedPaste ? `\x1b[200~${prompt}\x1b[201~` : prompt)
      if (bracketedPaste) {
        // A large paste takes codex a beat to ingest; a fixed delay can beat it to
        // the composer and the Enter is dropped (the prompt lands but never runs).
        // Wait for the paste to render and the session to fall quiet again, THEN
        // submit — Enter as its own keystroke.
        waitForQuiet(id, QUIET_MS, () => manager.write(id, '\r'))
      } else {
        // claude's carefully-tuned path is unchanged: Enter a fixed beat later.
        const t = setTimeout(() => {
          manager.write(id, '\r')
          deliveryCancels.delete(id)
        }, SUBMIT_DELAY_MS)
        deliveryCancels.set(id, () => clearTimeout(t))
      }
    })
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
      // Status: an agent tab is scanned against its own tool's approval patterns.
      const toolName = req.tool ?? config.defaultTool
      deps.statusHub?.registerPty(req.id, 'interactive', config.cliTools[toolName]?.approvalPatterns ?? [])
      // NOTE: no bracketed-paste framing here — the raw ESC of \x1b[200~ registers
      // as the Escape key in these TUIs (clears the composer / exits dialogs).
      if (launch.stdinPrompt) deliverPromptWhenReady(req.id, launch.stdinPrompt, launch.bracketedPaste ?? false)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  // Raw shell: spawn the chosen shell in the given folder with no seeded prompt.
  // Needs no config, so it works even before a config loads.
  ipcMain.handle(TERM.spawnShell, (_e, req: SpawnShellRequest): SpawnResult => {
    try {
      const def = resolveShell(req.shell)
      const resolved = deps.resolveCommand?.(def.command)
      manager.spawn(req.id, {
        file: def.command,
        args: def.args,
        cwd: req.cwd,
        cols: req.cols,
        rows: req.rows,
        resolved
      })
      // Status: a shell tab has no fixed tool, so scan against the union.
      deps.statusHub?.registerPty(req.id, 'shell', unionApprovalPatterns(deps.source.config))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.on(TERM.write, (_e, id: string, data: string) => manager.write(id, data))
  ipcMain.on(TERM.resize, (_e, id: string, cols: number, rows: number) => manager.resize(id, cols, rows))
  ipcMain.on(TERM.kill, (_e, id: string) => {
    cancelPendingPrompt(id)
    activity.clear(id)
    deps.statusHub?.dispose(id)
    manager.kill(id)
  })

  return manager
}
