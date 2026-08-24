// Pure transcript matching (supervision slice 5). Given one transcript's text
// and a query, produce the matching turns. No IO here — search-service.ts walks
// the files and calls this.
//
// Both roles are searched, and every hit says which one it was. The design doc
// left "user turns only, or agent output too?" open; searching both answers
// "which session did I ask about X" AND "which session hit that error", and the
// role label is what keeps the two distinguishable. Restricting to user turns
// would have silently made the second question unanswerable.

export type TurnRole = 'user' | 'agent'

export interface TranscriptMatch {
  role: TurnRole
  // The matching line, trimmed and collapsed — a transcript turn can be
  // thousands of characters and a result row has one line.
  excerpt: string
  // Character offset of the match within the excerpt, for highlighting.
  offset: number
  // Ordinal of the turn within the transcript, so a caller can show sequence.
  turn: number
}

// Result rows are one line; a whole turn is not.
export const EXCERPT_MAX = 160

// Collapse a turn to a single line and window it around the match, so the hit
// is always visible rather than truncated away at character 160 of a long turn.
//
// Takes the QUERY, not an index into the raw text. Collapsing whitespace moves
// every index after it, so an index computed against the raw turn points at the
// wrong character in the flattened excerpt — "fix\n\n  the sync comparator"
// highlighted six characters to the right of the match. Re-finding in the
// flattened text makes that class of bug impossible rather than merely fixed.
export function excerptAround(text: string, query: string, max = EXCERPT_MAX): { excerpt: string; offset: number } {
  const flat = text.replace(/\s+/g, ' ').trim()
  const at = flat.toLowerCase().indexOf(query.toLowerCase())
  // A query that survives in the raw text but not the flattened one (it spanned
  // a newline) still gets a readable excerpt; it just is not highlighted.
  if (at === -1) return { excerpt: flat.slice(0, max), offset: 0 }
  if (flat.length <= max) return { excerpt: flat, offset: at }
  const start = Math.max(0, Math.min(at - Math.floor(max / 3), flat.length - max))
  const head = start > 0 ? '…' : ''
  const tail = start + max < flat.length ? '…' : ''
  return { excerpt: head + flat.slice(start, start + max) + tail, offset: at - start + head.length }
}

// Case-insensitive substring. Deliberately not a regex: a query is typed by a
// human in a hurry, and an unescaped `(` should find a paren, not throw.
function indexOfQuery(haystack: string, query: string): number {
  return haystack.toLowerCase().indexOf(query.toLowerCase())
}

// Pull display text out of a claude message `content`, which is either a plain
// string or an array of blocks. Mirrors session-title.ts's reader.
function claudeText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b): b is { type: string; text: string } =>
      !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string'
    )
    .map((b) => b.text)
    .join(' ')
}

export function searchClaudeTranscript(content: string, query: string, limit = 20): TranscriptMatch[] {
  if (!query.trim()) return []
  const out: TranscriptMatch[] = []
  let turn = 0
  for (const line of content.split('\n')) {
    if (out.length >= limit) break
    if (!line.trim()) continue
    let o: { type?: string; isMeta?: boolean; message?: { content?: unknown } }
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    if (o?.type !== 'user' && o?.type !== 'assistant') continue
    // isMeta records are harness bookkeeping, not conversation.
    if (o.isMeta) continue
    const text = claudeText(o.message?.content)
    if (!text) continue
    turn++
    // System-injected user content is wrapped in angle-tags (command envelopes,
    // caveats). It is not something the human said, so a hit there would be a
    // false positive on "which session did I ask about X".
    if (o.type === 'user' && text.trimStart().startsWith('<')) continue
    const at = indexOfQuery(text, query)
    if (at === -1) continue
    const { excerpt, offset } = excerptAround(text, query)
    out.push({ role: o.type === 'user' ? 'user' : 'agent', excerpt, offset, turn })
  }
  return out
}

export function searchCodexTranscript(content: string, query: string, limit = 20): TranscriptMatch[] {
  if (!query.trim()) return []
  const out: TranscriptMatch[] = []
  let turn = 0
  for (const line of content.split('\n')) {
    if (out.length >= limit) break
    if (!line.trim()) continue
    let o: { payload?: { type?: string; message?: unknown } }
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    const p = o?.payload
    if (!p) continue
    const isUser = p.type === 'user_message'
    const isAgent = p.type === 'agent_message'
    if (!isUser && !isAgent) continue
    const text = typeof p.message === 'string' ? p.message : ''
    if (!text) continue
    turn++
    if (isUser && text.trimStart().startsWith('<')) continue
    const at = indexOfQuery(text, query)
    if (at === -1) continue
    const { excerpt, offset } = excerptAround(text, query)
    out.push({ role: isUser ? 'user' : 'agent', excerpt, offset, turn })
  }
  return out
}

export function searchTranscript(
  tool: string,
  content: string,
  query: string,
  limit = 20
): TranscriptMatch[] {
  if (tool === 'claude') return searchClaudeTranscript(content, query, limit)
  if (tool === 'codex') return searchCodexTranscript(content, query, limit)
  // An agent whose transcript format we do not know: report nothing rather
  // than pattern-matching raw JSON and surfacing field names as "hits".
  return []
}
