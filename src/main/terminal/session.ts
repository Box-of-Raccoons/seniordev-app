import type { Config } from '../config/schema'
import { resolveCwd } from './resolve'

export interface Launch {
  file: string
  args: string[]
  cwd: string
  stdinPrompt?: string
}

export function buildInteractiveLaunch(
  config: Config,
  opts: { tool?: string; ticketKey?: string; cwdOverride?: string },
  expandedPrompt?: string
): Launch {
  const toolName = opts.tool ?? config.defaultTool
  const tool = config.cliTools[toolName]
  if (!tool) throw new Error(`Unknown CLI tool: ${toolName}`)
  const cwd = resolveCwd(config, opts.ticketKey, opts.cwdOverride)
  const args = [...tool.interactiveArgs]

  if (expandedPrompt && tool.promptDelivery === 'arg') {
    const template = tool.promptArg ?? '{{prompt}}'
    args.push(template.replace('{{prompt}}', expandedPrompt))
    return { file: tool.command, args, cwd }
  }
  return {
    file: tool.command,
    args,
    cwd,
    stdinPrompt: expandedPrompt && tool.promptDelivery === 'stdin' ? expandedPrompt : undefined
  }
}
