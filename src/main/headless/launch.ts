import type { Config } from '../config/schema'
import type { ResolvedCommand } from '../terminal/resolve-command'
import { resolveCwd } from '../terminal/resolve'
import { DEFAULT_YOLO_PREAMBLE, DEFAULT_YOLO_RECAP } from '../config/presets'
import { resolveModelArgs } from '../config/model'

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
  opts: { tool?: string; ticketKey?: string; cwdOverride?: string; bare?: boolean; model?: string },
  expandedPrompt: string,
  resolveCommand?: (command: string) => ResolvedCommand | undefined
): HeadlessLaunch {
  const toolName = opts.tool ?? config.defaultTool
  const tool = config.cliTools[toolName]
  if (!tool) throw new Error(`Unknown CLI tool: ${toolName}`)
  if (!tool.headless) throw new Error(`Tool "${toolName}" has no headless config — YOLO unavailable`)

  const preamble = (config.yoloPreamble ?? DEFAULT_YOLO_PREAMBLE).trim()
  const recap = (config.yoloRecap ?? DEFAULT_YOLO_RECAP).trim()
  // Preamble is opening autonomy framing (prepended); recap is the closing
  // summary instruction (appended). Each is skipped when it resolves to empty.
  // bare skips both wrappers entirely — the classifier's "answer with only JSON"
  // contract is incompatible with the recap's "## Changes made" instruction.
  const prompt = opts.bare ? expandedPrompt : [preamble, expandedPrompt, recap].filter(Boolean).join('\n\n')
  // Resolution order: prompt frontmatter model → tool defaultModel → nothing.
  // Empty ⇒ no extra argv entries, so the line is unchanged from today.
  const modelArgs = resolveModelArgs(tool, opts.model)
  return {
    file: tool.command,
    args: [...tool.headless.args, ...modelArgs],
    cwd: resolveCwd(config, opts.ticketKey, opts.cwdOverride),
    // The prompt travels over stdin only (never argv) — see spawn-command.ts.
    prompt,
    outputParser: tool.headless.outputParser,
    sessionIdPattern: tool.headless.sessionIdPattern,
    toolName,
    canResume: (tool.resumeArgs?.length ?? 0) > 0,
    resolved: resolveCommand?.(tool.command)
  }
}
