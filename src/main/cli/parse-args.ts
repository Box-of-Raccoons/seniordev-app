import type { StartupOptions } from '../../shared/ipc'
import { isTicketKey } from '../../shared/ticket-key'

export function parseStartupArgs(argv: string[], readFile: (p: string) => string): StartupOptions {
  const tickets: string[] = []
  const warnings: string[] = []
  let mode: 'interactive' | 'yolo' | undefined
  let promptName: string | undefined
  let promptText: string | undefined
  let tool: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--interactive') mode = mode ?? 'interactive'
    else if (a === '--yolo') {
      mode = 'yolo'
      // Only consume the next token as a prompt name if it is not a flag and does not
      // look like a ticket key — a prompt named like a ticket key can't be passed
      // positionally; use --prompt or a config alias instead.
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('-') && !isTicketKey(next)) {
        promptName = next
        i++
      }
    }
    else if (a === '--tool') tool = argv[++i]
    else if (a === '--prompt') {
      mode = mode ?? 'interactive'
      const v = argv[++i] ?? ''
      if (v.startsWith('@')) {
        const path = v.slice(1)
        try {
          promptText = readFile(path)
        } catch (err) {
          warnings.push(`--prompt @${path}: ${err instanceof Error ? err.message : String(err)}`)
        }
      } else {
        promptText = v
      }
    } else if (!a.startsWith('-') && isTicketKey(a)) {
      tickets.push(a.toUpperCase())
    }
  }

  const hasSession =
    mode !== undefined || promptName !== undefined || promptText !== undefined || tool !== undefined
  const session = hasSession ? { mode: mode ?? 'interactive', promptName, promptText, tool } : undefined
  return {
    tickets,
    session,
    ...(warnings.length ? { warnings } : {})
  }
}
