import type { StartupOptions } from '../../shared/ipc'
import { isTicketKey } from '../../shared/ticket-key'

export function parseStartupArgs(argv: string[], readFile: (p: string) => string): StartupOptions {
  const tickets: string[] = []
  const warnings: string[] = []
  let mode: 'interactive' | 'yolo' | undefined
  let promptName: string | undefined
  let promptText: string | undefined
  let tool: string | undefined
  let folder: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    // Accept both `--flag value` and `--flag=value`. Electron/Chromium regroups a
    // bare `--flag value` launch — it clusters its own switches and pushes the
    // value to the end as a positional, so a Chromium switch can slot in right
    // after `--flag` and the value no longer follows it. The `--flag=value` form is
    // a single argv token, immune to that reordering, and is what CLI callers (the
    // voice sidecar, any second-instance launch) should use. See resolve-launch.
    const eq = a.startsWith('--') ? a.indexOf('=') : -1
    const flag = eq === -1 ? a : a.slice(0, eq)
    const inlineVal = eq === -1 ? undefined : a.slice(eq + 1)

    if (flag === '--interactive') mode = mode ?? 'interactive'
    else if (flag === '--yolo') {
      mode = 'yolo'
      if (inlineVal !== undefined) {
        if (inlineVal) promptName = inlineVal
      } else {
        // Only consume the next token as a prompt name if it is not a flag and does
        // not look like a ticket key — a prompt named like a ticket key can't be
        // passed positionally; use --prompt or a config alias instead.
        const next = argv[i + 1]
        if (next !== undefined && !next.startsWith('-') && !isTicketKey(next)) {
          promptName = next
          i++
        }
      }
    }
    // Mode-independent role: `--yolo <name>` is the only other way to name a
    // prompt, and it forces yolo mode — so an interactive session with a role
    // (e.g. the voice sidecar's confirm-gate downgrade) needs this flag.
    else if (flag === '--role') promptName = inlineVal !== undefined ? inlineVal : argv[++i]
    else if (flag === '--tool') tool = inlineVal !== undefined ? inlineVal : argv[++i]
    else if (flag === '--folder') folder = inlineVal !== undefined ? inlineVal : argv[++i]
    else if (flag === '--prompt') {
      mode = mode ?? 'interactive'
      const v = inlineVal !== undefined ? inlineVal : (argv[++i] ?? '')
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
  const session = hasSession
    ? { mode: mode ?? 'interactive', promptName, promptText, tool, ...(folder !== undefined ? { folder } : {}) }
    : undefined
  return {
    tickets,
    session,
    ...(warnings.length ? { warnings } : {})
  }
}
