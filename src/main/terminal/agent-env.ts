// Strip the "I am running inside Claude Code" markers from the environment handed
// to a spawned agent.
//
// Why: node-pty inherits SeniorDev's own environment. If SeniorDev is launched
// from a Claude Code session (or any process that sets these), an inherited
// CLAUDECODE / CLAUDE_CODE_* tells a spawned `claude` it is a nested CHILD session
// — and in that mode claude does not persist a resumable transcript, so the S4
// sidebar could never resume it (and it silently fails, which is worse). Dropping
// the markers makes every launched claude a normal top-level session regardless of
// how SeniorDev itself was started. codex ignores these, so it was unaffected —
// which is exactly why codex resumed but claude didn't when the app was booted
// from a Claude Code terminal.
//
// Verified 2026-07-30: a node-pty `claude` persists with these scrubbed and does
// NOT persist with them present. ANTHROPIC_* (auth) and everything else pass
// through untouched, so login/API access is preserved.
export function sanitizeAgentEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue
    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) continue
    out[k] = v
  }
  return out
}
