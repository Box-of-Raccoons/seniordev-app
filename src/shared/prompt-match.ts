// Does a tab's rendered buffer text show an approval prompt? Each pattern is a
// regex source, matched case-insensitively; a malformed one is skipped rather
// than thrown, so a bad config edit degrades to "no match" instead of crashing
// the scan. Empty patterns means no prompt detection — the intended graceful
// default for a tool with no approvalPatterns configured.
//
// Shared because the renderer reads the buffer but the main-process status hub
// (which holds the config-driven patterns) does the matching. Pure, no imports.
export function matchesPrompt(bufferText: string, patterns: readonly string[]): boolean {
  for (const src of patterns) {
    if (!src) continue
    let re: RegExp
    try {
      re = new RegExp(src, 'i')
    } catch {
      continue
    }
    if (re.test(bufferText)) return true
  }
  return false
}
