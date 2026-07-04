import type { Config } from '../config/schema'
import type { ResolvedCommand } from './resolve-command'
import { resolveCwd } from './resolve'
import { pickPromptModel, resolveModelArgs, type PromptModel } from '../config/model'

export interface Launch {
  file: string
  args: string[]
  cwd: string
  stdinPrompt?: string
  resolved?: ResolvedCommand
}

export function buildInteractiveLaunch(
  config: Config,
  opts: { tool?: string; ticketKey?: string; cwdOverride?: string; resume?: { sessionId: string }; model?: PromptModel },
  expandedPrompt?: string,
  resolveCommand?: (command: string) => ResolvedCommand | undefined
): Launch {
  const toolName = opts.tool ?? config.defaultTool
  const tool = config.cliTools[toolName]
  if (!tool) throw new Error(`Unknown CLI tool: ${toolName}`)
  const cwd = resolveCwd(config, opts.ticketKey, opts.cwdOverride)
  // Session ids come from the CLI's own output (UUIDs), but resume args can ride
  // through a cmd /c shim launch that RE-PARSES its line — so refuse anything
  // outside the UUID charset rather than let it near a shell. Defense in depth.
  if (opts.resume && !/^[0-9a-zA-Z-]+$/.test(opts.resume.sessionId)) {
    throw new Error(`Invalid session id for resume: ${opts.resume.sessionId}`)
  }
  // Function replacer: a literal '$' in a session id must not trigger $&-style patterns.
  const resumeArgs =
    opts.resume && tool.resumeArgs
      ? tool.resumeArgs.map((a) => a.replace('{{sessionId}}', () => opts.resume!.sessionId))
      : []
  // A fresh launch gets the resolved model (prompt frontmatter — this tool's
  // entry if a per-tool map — → tool defaultModel → nothing). A resume reconnects
  // to a session that already has its model, so we leave its argv as-is rather
  // than re-asserting a model flag.
  const modelArgs = opts.resume ? [] : resolveModelArgs(tool, pickPromptModel(opts.model, toolName))
  const args = [...tool.interactiveArgs, ...resumeArgs, ...modelArgs]
  const resolved = resolveCommand?.(tool.command)

  // Deliver the prompt as a launch arg ONLY when it can't be re-parsed by cmd.exe.
  // A shell shim (.cmd/.bat) or an unresolved command routes through `cmd /c` (see
  // spawn-command.ts), which re-parses its command line — so arbitrary Jira ticket
  // text in the prompt could inject commands or have its newlines mangled. When the
  // resolver tells us the command is such a shim, downgrade 'arg' delivery to stdin.
  // (No resolver — POSIX / tests — keeps today's behavior untouched.)
  const argUnsafe = resolved !== undefined && resolved.kind !== 'exe'

  if (expandedPrompt && tool.promptDelivery === 'arg' && !argUnsafe) {
    const template = tool.promptArg ?? '{{prompt}}'
    // Function replacer: avoids $&/$$/etc. being treated as special patterns
    // when the prompt content contains a literal '$'.
    args.push(template.replace('{{prompt}}', () => expandedPrompt))
    return { file: tool.command, args, cwd, resolved }
  }

  const deliverViaStdin =
    expandedPrompt !== undefined &&
    (tool.promptDelivery === 'stdin' || (tool.promptDelivery === 'arg' && argUnsafe))
  return {
    file: tool.command,
    args,
    cwd,
    stdinPrompt: deliverViaStdin ? expandedPrompt : undefined,
    resolved
  }
}
