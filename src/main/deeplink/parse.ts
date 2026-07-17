import type { DeepLink } from '../../shared/ipc'
import { isTicketKey } from '../../shared/ticket-key'

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
  if (!ticket || !isTicketKey(ticket)) return null
  // Optional prefill hints. role must be a prompt-name slug; folder is a plain
  // path string (prefilled into a text field, never run), trimmed and length-capped.
  const roleRaw = parsed.searchParams.get('role')
  const role = roleRaw && /^[a-z0-9][a-z0-9-]*$/i.test(roleRaw) ? roleRaw : undefined
  const folderRaw = parsed.searchParams.get('folder')?.trim()
  const folder = folderRaw ? folderRaw.slice(0, 500) : undefined
  return {
    action,
    ticket: ticket.toUpperCase(),
    ...(role ? { role } : {}),
    ...(folder ? { folder } : {})
  }
}

export function findDeepLinkArg(argv: string[]): string | undefined {
  return argv.find((a) => a.toLowerCase().startsWith('seniordev://'))
}

// Map a second-instance argv onto deep links: an explicit seniordev:// URL wins;
// otherwise plain ticket keys are forwarded as open links, matching what a cold
// `seniordev PROJ-123` launch does via parseStartupArgs.
export function linksFromArgv(argv: string[]): DeepLink[] {
  const raw = findDeepLinkArg(argv)
  const link = raw ? parseDeepLink(raw) : null
  if (link) return [link]
  return argv
    .filter((a) => !a.startsWith('-') && isTicketKey(a))
    .map((a) => ({ action: 'open' as const, ticket: a.toUpperCase() }))
}
