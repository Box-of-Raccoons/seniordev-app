import type { Config } from '../config/schema'
import type { ResolvedCommand } from '../terminal/resolve-command'
import { resolveCwd } from '../terminal/resolve'
import { DEFAULT_YOLO_RECAP } from '../config/presets'

export interface HeadlessLaunch {
  file: string
  args: string[]
  cwd: string
  prompt: string
  outputParser: 'claude-stream-json' | 'codex-jsonl' | 'text'
  sessionIdPattern?: string
  toolName: string
  canResume: boolean
  resolved?: ResolvedCommand
}

export function buildHeadlessLaunch(
  config: Config,
  opts: { tool?: string; ticketKey?: string; cwdOverride?: string },
  expandedPrompt: string,
  resolveCommand?: (command: string) => ResolvedCommand | undefined
): HeadlessLaunch {
  const toolName = opts.tool ?? config.defaultTool
  const tool = config.cliTools[toolName]
  if (!tool) throw new Error(`Unknown CLI tool: ${toolName}`)
  if (!tool.headless) throw new Error(`Tool "${toolName}" has no headless config — YOLO unavailable`)

  const recap = (config.yoloRecap ?? DEFAULT_YOLO_RECAP).trim()
  return {
    file: tool.command,
    args: [...tool.headless.args],
    cwd: resolveCwd(config, opts.ticketKey, opts.cwdOverride),
    // The prompt travels over stdin only (never argv) — see spawn-command.ts.
    prompt: recap ? `${expandedPrompt}\n\n${recap}` : expandedPrompt,
    outputParser: tool.headless.outputParser,
    sessionIdPattern: tool.headless.sessionIdPattern,
    toolName,
    canResume: (tool.resumeArgs?.length ?? 0) > 0,
    resolved: resolveCommand?.(tool.command)
  }
}
