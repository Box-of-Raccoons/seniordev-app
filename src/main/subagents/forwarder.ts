import { createClaudeSubagentWatcher } from './claude-watcher'
import { createCodexSubagentWatcher } from './codex-watcher'
import { SUBAGENTS } from '../../shared/ipc'
import type { SubagentWatcher } from './types'

// Wires the (global, read-only) claude + codex subagent watchers to the renderer:
// each watcher event is pushed one-way over IPC to the focused window. There is
// no renderer→main call — the panel is a pure sink. Watcher construction is
// injectable so a unit test can drive fake emitters without touching the disk.
export interface SubagentForwarderDeps {
  getSender: () => Electron.WebContents | undefined
  makeClaude?: () => SubagentWatcher
  makeCodex?: () => SubagentWatcher
}

export function startSubagentForwarding(deps: SubagentForwarderDeps): { dispose: () => void } {
  const claude = (deps.makeClaude ?? createClaudeSubagentWatcher)()
  const codex = (deps.makeCodex ?? createCodexSubagentWatcher)()

  const wire = (w: SubagentWatcher): void => {
    w.on('spawn', (e) => deps.getSender()?.send(SUBAGENTS.spawn, e))
    w.on('activity', (e) => deps.getSender()?.send(SUBAGENTS.activity, e))
    w.on('done', (e) => deps.getSender()?.send(SUBAGENTS.done, e))
    // A watcher error is non-fatal: the panel simply stops receiving updates for
    // that CLI. Never let it crash the main process.
    w.on('error', () => {})
  }
  wire(claude)
  wire(codex)

  return {
    dispose: (): void => {
      claude.close()
      codex.close()
    }
  }
}
