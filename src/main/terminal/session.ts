import type { Config } from '../config/schema'
import { resolveCwd } from './resolve'

export interface Launch {
  file: string
  args: string[]
  cwd: string
}

export function buildInteractiveLaunch(
  config: Config,
  opts: { tool?: string; ticketKey?: string; cwdOverride?: string }
): Launch {
  const toolName = opts.tool ?? config.defaultTool
  const tool = config.cliTools[toolName]
  if (!tool) throw new Error(`Unknown CLI tool: ${toolName}`)
  return {
    file: tool.command,
    args: [...tool.interactiveArgs],
    cwd: resolveCwd(config, opts.ticketKey, opts.cwdOverride)
  }
}
