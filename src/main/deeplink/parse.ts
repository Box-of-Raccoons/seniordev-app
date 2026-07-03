import type { DeepLink } from '../../shared/ipc'

const TICKET = /^[A-Za-z][A-Za-z0-9]*-\d+$/

export function parseDeepLink(url: string): DeepLink | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  // Custom-scheme quirks: for seniordev://open?ticket=X the "open" lands in
  // url.host; for seniordev:open or seniordev:///open it lands in url.pathname
  // (with leading slashes). Prefer host, fall back to the slash-stripped path.
  const raw = parsed.host || parsed.pathname.replace(/^\/+/, '')
  const action = raw.toLowerCase()
  if (action !== 'open' && action !== 'yolo') return null
  const ticket = parsed.searchParams.get('ticket')
  if (!ticket || !TICKET.test(ticket)) return null
  return { action, ticket: ticket.toUpperCase() }
}

export function findDeepLinkArg(argv: string[]): string | undefined {
  return argv.find((a) => a.toLowerCase().startsWith('seniordev://'))
}
