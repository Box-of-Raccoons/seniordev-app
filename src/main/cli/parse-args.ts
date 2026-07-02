import type { StartupOptions } from '../../shared/ipc'

const TICKET = /^[A-Za-z][A-Za-z0-9]*-\d+$/

export function parseStartupArgs(argv: string[], readFile: (p: string) => string): StartupOptions {
  const tickets: string[] = []
  let mode: 'interactive' | 'yolo' | undefined
  let promptName: string | undefined
  let promptText: string | undefined
  let tool: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--interactive') mode = mode ?? 'interactive'
    else if (a === '--yolo') { mode = 'yolo'; promptName = argv[++i] }
    else if (a === '--tool') tool = argv[++i]
    else if (a === '--prompt') {
      const v = argv[++i] ?? ''
      promptText = v.startsWith('@') ? readFile(v.slice(1)) : v
    } else if (!a.startsWith('-') && TICKET.test(a)) {
      tickets.push(a.toUpperCase())
    }
  }

  const hasSession =
    mode !== undefined || promptName !== undefined || promptText !== undefined || tool !== undefined
  const session = hasSession ? { mode: mode ?? 'interactive', promptName, promptText, tool } : undefined
  return { tickets, session }
}
