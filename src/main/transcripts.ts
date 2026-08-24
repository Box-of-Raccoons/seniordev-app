import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { claudeProjectsDir } from './session-resumable'
import { codexSessionsDir } from './codex/session-discovery'

// Locating and reading an agent's own transcript. Shared by the cost meter
// (slice 3a) and transcript search (slice 5) so the file-layout knowledge lives
// in one place; the layouts are the same internal contracts session-title.ts
// and session-resumable.ts already depend on.
//
// Every failure returns null. A transcript is another program's file and can be
// missing, mid-write, or unreadable at any moment; that is a normal state here,
// not an error worth propagating.

// claude stores <projects>/<project-hash>/<id>.jsonl. We scan the project dirs
// rather than deriving the hash from cwd, matching claudeHasTranscript — the
// path-encoding scheme is claude's, not ours, and could differ for odd cwds.
export function locateClaudeTranscript(sessionId: string, projectsDir = claudeProjectsDir()): string | null {
  let dirs: string[]
  try {
    dirs = readdirSync(projectsDir)
  } catch {
    return null
  }
  for (const d of dirs) {
    const p = join(projectsDir, d, `${sessionId}.jsonl`)
    try {
      if (statSync(p).isFile()) return p
    } catch {
      // Not in this project dir; keep scanning.
    }
  }
  return null
}

// codex nests rollouts by date and embeds the id in the filename.
export function locateCodexTranscript(sessionId: string, sessionsDir = codexSessionsDir()): string | null {
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
    return join(sessionsDir, rel)
  }
  return null
}

// The transcript file for a conversation, or null. Separated from reading so a
// caller can stat it (for a change check) without pulling the whole file into
// memory — these run to tens of megabytes.
export function locateTranscript(
  conv: { tool: string; agentSessionId: string | null },
  deps?: { claudeProjectsDir?: string; codexSessionsDir?: string }
): string | null {
  if (!conv.agentSessionId) return null
  if (conv.tool === 'claude') return locateClaudeTranscript(conv.agentSessionId, deps?.claudeProjectsDir)
  if (conv.tool === 'codex') return locateCodexTranscript(conv.agentSessionId, deps?.codexSessionsDir)
  // An agent whose file layout we do not know.
  return null
}

// Size and last-modified, as a cheap identity for "has this file changed".
export function transcriptStamp(path: string): { mtimeMs: number; size: number } | null {
  try {
    const s = statSync(path)
    return { mtimeMs: s.mtimeMs, size: s.size }
  } catch {
    return null
  }
}

export function readClaudeTranscript(sessionId: string, projectsDir = claudeProjectsDir()): string | null {
  const p = locateClaudeTranscript(sessionId, projectsDir)
  return p ? readFileAt(p) : null
}

export function readCodexTranscript(sessionId: string, sessionsDir = codexSessionsDir()): string | null {
  const p = locateCodexTranscript(sessionId, sessionsDir)
  return p ? readFileAt(p) : null
}

export function readFileAt(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

export function readTranscript(
  conv: { tool: string; agentSessionId: string | null },
  deps?: { claudeProjectsDir?: string; codexSessionsDir?: string }
): string | null {
  const p = locateTranscript(conv, deps)
  return p ? readFileAt(p) : null
}
