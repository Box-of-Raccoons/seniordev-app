// S1 buffer scan (renderer side). Two pure pieces: read the rendered xterm
// buffer into plain text, and test that text against a tool's approvalPatterns.
// Matching happens against xterm's PARSED buffer, so ANSI sequences, wrapping,
// and ConPTY chunking are already resolved (spec 5.4). Pure and injectable, so
// both halves are testable without a real terminal (spec 5.6).

// The minimal slice of xterm's IBuffer this needs. term.buffer.active satisfies
// it; a fake object does too, for tests.
export interface ScanBufferLine {
  translateToString(trimRight?: boolean): string
}
export interface ScanBuffer {
  readonly baseY: number
  getLine(y: number): ScanBufferLine | undefined
}

// Read `rows` lines starting at the viewport top (baseY) into newline-joined
// text — the last screenful, which is where a prompt sits (grounding 1.3).
export function readBufferText(buffer: ScanBuffer, rows: number): string {
  const out: string[] = []
  for (let i = 0; i < rows; i++) {
    const line = buffer.getLine(buffer.baseY + i)
    out.push(line ? line.translateToString(true) : '')
  }
  return out.join('\n')
}

// Does the rendered buffer show an approval prompt? Each pattern is a regex
// source, matched case-insensitively; a malformed one is skipped rather than
// thrown, so a bad config edit degrades to "no match" instead of crashing the
// scan. Empty patterns (e.g. a tool with no approvalPatterns configured) means
// no prompt detection, which is the intended graceful default (see step 5).
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
