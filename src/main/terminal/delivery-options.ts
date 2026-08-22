import type { Config } from '../config/schema'

// How a prompt has to be typed into a tool's TUI. Resolved in ONE place because
// both write paths run through prompt-delivery: the spawn path (session.ts) and
// the scheduled injection (index.ts). They must agree, and the agreement is not
// cosmetic — codex without the bracketed-paste markers submits per newline, so a
// multi-line prompt fires its first line as the whole request.
export interface DeliveryOptions {
  /** The tool whose config actually backs these options. */
  tool: string
  bracketedPaste: boolean
}

// `tool` is the caller's declared tool (a conversation record's, a launch
// request's); absent means the configured default. A missing config THROWS
// rather than defaulting to 'claude': a guess here is exactly how a codex
// session receives an unframed paste. The scheduled caller records the throw as
// a failed firing, which notifies, instead of writing the wrong bytes.
export function deliveryOptionsFor(tool: string | undefined, config: Config | null): DeliveryOptions {
  if (!config) throw new Error('no configuration is loaded')
  const requested = tool ?? config.defaultTool
  // A stale tool name (the conversation outlived a config edit) resolves to the
  // default tool rather than silently to "no bracketed paste".
  const name = config.cliTools[requested] ? requested : config.defaultTool
  return { tool: name, bracketedPaste: config.cliTools[name]?.bracketedPaste ?? false }
}
