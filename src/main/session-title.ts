import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { claudeProjectsDir } from './session-resumable'
import { codexSessionsDir } from './codex/session-discovery'

// S7: derive a conversation title from the first real user message in the agent's
// own transcript, for sessions launched without a prompt (bare "New Session" /
// instant launches) that would otherwise read as "session · <project>". The file
// locations are the same internal contracts the resume/discovery code already
// depends on (session-resumable.ts, codex/session-discovery.ts); every parse
// failure degrades to null, which leaves the existing (generic) title untouched.

// Pull display text out of a claude message `content`, which is either a plain
// string or an array of content blocks. Returns null when there is no text.
function claudeContentText(content: unknown): string | null {
  if (typeof content === 'string') return content.trim() || null
  if (Array.isArray(content)) {
    const t = content
      .filter((b): b is { type: string; text: string } =>
        !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string'
      )
      .map((b) => b.text)
      .join(' ')
      .trim()
    return t || null
  }
  return null
}

// First genuine user turn in a claude transcript (`<id>.jsonl`). Skips `isMeta`
// records and system-injected content wrapped in angle-tags (local-command
// caveats, command envelopes), which precede the real prompt. Pure over the file
// contents so it is unit-testable without touching disk.
export function parseClaudeFirstUserText(content: string): string | null {
  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    let o: { type?: string; isMeta?: boolean; message?: { content?: unknown } }
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    if (o?.type !== 'user' || o?.isMeta) continue
    const text = claudeContentText(o?.message?.content)
    if (text && !text.startsWith('<')) return text
  }
  return null
}

// First user turn in a codex rollout: an `event_msg`/`user_message` payload whose
// `message` is the typed text. Pure over the file contents.
export function parseCodexFirstUserText(content: string): string | null {
  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    let o: { payload?: { type?: string; message?: unknown } }
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    if (o?.payload?.type === 'user_message' && typeof o.payload.message === 'string') {
      const t = o.payload.message.trim()
      if (t && !t.startsWith('<')) return t
    }
  }
  return null
}

// Condense a message into a tab/sidebar title: first non-empty line, whitespace
// collapsed, truncated with an ellipsis.
export function summarizeTitle(text: string, maxLen = 50): string {
  const firstLine = text.replace(/\r/g, '').split('\n').map((s) => s.trim()).find((s) => s.length > 0) ?? ''
  const collapsed = firstLine.replace(/\s+/g, ' ').trim()
  return collapsed.length > maxLen ? collapsed.slice(0, maxLen - 1).trimEnd() + '…' : collapsed
}

function claudeFirstUserText(sessionId: string, projectsDir: string): string | null {
  let dirs: string[]
  try {
    dirs = readdirSync(projectsDir)
  } catch {
    return null
  }
  for (const d of dirs) {
    const f = join(projectsDir, d, `${sessionId}.jsonl`)
    if (!existsSync(f)) continue
    try {
      return parseClaudeFirstUserText(readFileSync(f, 'utf8'))
    } catch {
      return null
    }
  }
  return null
}

function codexFirstUserText(sessionId: string, sessionsDir: string): string | null {
  let entries: string[]
  try {
    entries = readdirSync(sessionsDir, { recursive: true }) as string[]
  } catch {
    return null
  }
  const idLc = sessionId.toLowerCase()
  for (const rel of entries) {
    const base = (rel.split(/[\\/]/).pop() ?? '').toLowerCase()
    if (!base.endsWith('.jsonl') || !base.includes(idLc)) continue
    try {
      return parseCodexFirstUserText(readFileSync(join(sessionsDir, rel), 'utf8'))
    } catch {
      return null
    }
  }
  return null
}

// Live title backfill for a just-spawned bare conversation: poll the transcript
// until a first message resolves (or a timeout), re-reading the conversation each
// tick so a codex id discovered after spawn is picked up. `getConv` returns the
// current record (or undefined if it was closed). Resolves the title or null.
export function pollForTitle(
  getConv: () => { tool: string; agentSessionId: string | null } | undefined,
  opts?: { intervalMs?: number; timeoutMs?: number; deps?: { claudeProjectsDir?: string; codexSessionsDir?: string } }
): Promise<string | null> {
  const intervalMs = opts?.intervalMs ?? 1500
  const timeoutMs = opts?.timeoutMs ?? 30000
  const start = Date.now()
  return new Promise((resolve) => {
    const tick = (): void => {
      const c = getConv()
      const title = c ? conversationTitleFromTranscript(c, opts?.deps) : null
      if (title) return resolve(title)
      if (!c || Date.now() - start >= timeoutMs) return resolve(null)
      setTimeout(tick, intervalMs)
    }
    setTimeout(tick, intervalMs)
  })
}

// The summarized title for a conversation, from its agent's transcript, or null
// when there is no resolvable first message yet (nothing typed, or no transcript).
export function conversationTitleFromTranscript(
  conv: { tool: string; agentSessionId: string | null },
  deps?: { claudeProjectsDir?: string; codexSessionsDir?: string }
): string | null {
  if (!conv.agentSessionId) return null
  let text: string | null = null
  if (conv.tool === 'claude') text = claudeFirstUserText(conv.agentSessionId, deps?.claudeProjectsDir ?? claudeProjectsDir())
  else if (conv.tool === 'codex') text = codexFirstUserText(conv.agentSessionId, deps?.codexSessionsDir ?? codexSessionsDir())
  if (!text) return null
  const title = summarizeTitle(text)
  return title || null
}
