import { readdirSync, readFileSync } from 'node:fs'
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
export function readClaudeTranscript(sessionId: string, projectsDir = claudeProjectsDir()): string | null {
  let dirs: string[]
  try {
    dirs = readdirSync(projectsDir)
  } catch {
    return null
  }
  for (const d of dirs) {
    try {
      return readFileSync(join(projectsDir, d, `${sessionId}.jsonl`), 'utf8')
    } catch {
      // Not in this project dir; keep scanning.
    }
  }
  return null
}

// codex nests rollouts by date and embeds the id in the filename.
export function readCodexTranscript(sessionId: string, sessionsDir = codexSessionsDir()): string | null {
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
      return readFileSync(join(sessionsDir, rel), 'utf8')
    } catch {
      return null
    }
  }
  return null
}

export function readTranscript(
  conv: { tool: string; agentSessionId: string | null },
  deps?: { claudeProjectsDir?: string; codexSessionsDir?: string }
): string | null {
  if (!conv.agentSessionId) return null
  if (conv.tool === 'claude') return readClaudeTranscript(conv.agentSessionId, deps?.claudeProjectsDir)
  if (conv.tool === 'codex') return readCodexTranscript(conv.agentSessionId, deps?.codexSessionsDir)
  // An agent whose file layout we do not know.
  return null
}
