import { ipcMain } from 'electron'
import { requireConfig, type ConfigSource } from '../config/store'
import { TerminalManager, type PtySpawner } from '../terminal/manager'
import { buildInteractiveLaunch } from '../terminal/session'
import { resolveShell } from '../terminal/shell'
import type { ResolvedCommand } from '../terminal/resolve-command'
import { TERM, type SpawnTerminalRequest, type SpawnShellRequest, type SpawnResult } from '../../shared/ipc'
import { resolveExpandedPrompt } from './resolve-prompt'
import { createSessionActivity, type SessionActivity } from '../terminal/activity'
import { createPromptDelivery, type PromptDelivery } from '../terminal/prompt-delivery'
import type { StatusHub } from '../terminal/status-hub'
import type { Config } from '../config/schema'
import type { SessionPersistence } from '../session-persistence'

export interface TerminalDeps {
  source: ConfigSource
  resolveCommand?: (command: string) => ResolvedCommand | undefined
  // S1 status: the shared activity tracker (so status and prompt delivery detect
  // quiet from one source) and the hub that turns events into status updates.
  // Optional so existing tests that exercise only prompt delivery need neither.
  activity?: SessionActivity
  statusHub?: StatusHub
  // S3 persistence: auto-create the project + conversation on spawn and capture
  // the resume id. Optional so prompt-delivery tests need not wire it.
  persistence?: SessionPersistence
  // Shared with the schedule runner so both write through one delivery (and one
  // cancel map). Optional: a bare test lets this module build its own.
  promptDelivery?: PromptDelivery
}

// A shell tab has no fixed tool, so it is scanned against every tool's approval
// patterns — if a user runs claude or codex by hand, the union still matches
// (plan section 3). Deduped; empty when no config has loaded yet.
function unionApprovalPatterns(config: Config | null): string[] {
  if (!config) return []
  return [...new Set(Object.values(config.cliTools).flatMap((t) => t.approvalPatterns ?? []))]
}

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
      delivery.cancel(id)
      activity.clear(id)
      deps.statusHub?.exit(id, exitCode)
      deps.persistence?.onTabExit(id) // unpin its project from the live set (S3 archive)
    }
  })

  // Prompt delivery is shared, not owned: index.ts passes in the SAME instance
  // the schedule runner writes through, so a kill cancels a scheduled delivery in
  // flight exactly as it cancels a launch one. A bare test gets its own.
  const delivery =
    deps.promptDelivery ?? createPromptDelivery({ write: (id, data) => manager.write(id, data), activity })

  ipcMain.handle(TERM.spawn, async (_e, req: SpawnTerminalRequest): Promise<SpawnResult> => {
    try {
      const config = requireConfig(deps.source)
      const expanded = await resolveExpandedPrompt(config, deps.source, req)
      // conversationId doubles as the claude --session-id to pre-assign (S3). A
      // tool without sessionIdArgs (codex) ignores it inside buildInteractiveLaunch.
      const launch = buildInteractiveLaunch(
        config,
        // req.model is an explicit per-launch choice (a scheduled launch that
        // named one) and wins over the prompt's declared model: it is the more
        // specific of the two and was authored deliberately for this run.
        { ...req, sessionId: req.conversationId, model: req.model ?? expanded?.model },
        expanded?.prompt,
        deps.resolveCommand
      )
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
      // S3: persist the project + conversation and capture the resume id. claude
      // pre-assigns (id == conversationId, known now); codex is discovered from the
      // rollout dir starting at spawn. Skipped for a caller with no conversationId.
      if (req.conversationId && deps.persistence) {
        const preAssigned = (config.cliTools[toolName]?.sessionIdArgs?.length ?? 0) > 0
        deps.persistence.onAgentSpawn({
          conversationId: req.conversationId,
          tool: toolName,
          cwd: launch.cwd,
          title: req.title ?? '',
          ptyId: req.id,
          preAssignedSessionId: preAssigned ? req.conversationId : undefined,
          // S5: recorded on the conversation (worktreePath/branch) and used to
          // remember the project's last checkbox choice (worktreeDefault).
          worktreePath: req.worktreePath,
          branch: req.branch,
          worktreeDefault: req.worktreeDefault,
          // S7: a launch carrying a description has a meaningful title; a bare one
          // (no input) is auto-titled and gets a first-message backfill.
          hadPrompt: !!req.input
        })
      }
      // NOTE: no bracketed-paste framing here — the raw ESC of \x1b[200~ registers
      // as the Escape key in these TUIs (clears the composer / exits dialogs).
      if (launch.stdinPrompt) delivery.deliver(req.id, launch.stdinPrompt, launch.bracketedPaste ?? false)
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
    delivery.cancel(id)
    activity.clear(id)
    deps.statusHub?.dispose(id)
    deps.persistence?.onTabExit(id) // unpin its project from the live set (S3 archive)
    manager.kill(id)
  })

  return manager
}
