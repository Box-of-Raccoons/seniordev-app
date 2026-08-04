import { parseStartupArgs } from '../cli/parse-args'
import { linksFromArgv } from '../deeplink/parse'
import type { DeepLink, WarmStartup } from '../../shared/ipc'

// What a second launch's argv resolves to, for the already-running instance:
//   - `session`: a `--prompt|--yolo|--tool|--interactive` launch auto-starts a
//     new tab (matching cold start). The local command line is trusted, so —
//     unlike a deep link — this runs without a review step.
//   - `links`: a `seniordev://…` URL or bare ticket keys, which prefill a
//     composer for the developer to review and launch (existing behavior).
// A session wins over links so `seniordev PROJ-1 --prompt "…"` opens one session
// tab (with the ticket carried), not a session *and* a prefilled composer.
export type SecondInstanceAction =
  | { kind: 'session'; warm: WarmStartup; warnings: string[] }
  | { kind: 'links'; links: DeepLink[] }

export function resolveSecondInstance(
  argv: string[],
  readFile: (p: string) => string
): SecondInstanceAction {
  const startup = parseStartupArgs(argv.slice(1), readFile)
  if (startup.session) {
    return {
      kind: 'session',
      warm: { session: startup.session, ticket: startup.tickets[0] },
      warnings: startup.warnings ?? []
    }
  }
  return { kind: 'links', links: linksFromArgv(argv) }
}
