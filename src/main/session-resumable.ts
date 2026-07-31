import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { codexSessionsDir } from './codex/session-discovery'

// Whether a stored conversation can ACTUALLY be resumed — computed fresh, from the
// agent's own on-disk transcript, not from the mere presence of a stored id.
//
// The bug this fixes: SeniorDev pre-assigns claude's session id via --session-id
// at spawn and stores it immediately (session-persistence.onAgentSpawn), before
// any message. But claude only writes the conversation transcript once the session
// has content. So a claude session that was spawned but never typed into has a
// stored agentSessionId yet no resumable transcript, and `claude --resume <id>`
// fails with "no conversation with session id". The sidebar must not offer such a
// resume, so it asks here instead of trusting agentSessionId. codex is symmetric:
// its rollout file exists from spawn (before any message), so existence is not
// enough either — the transcript must record a real user turn.
//
// These paths are internal contracts of each CLI (same class of coupling as the
// codex rollout discovery already in session-discovery.ts). Every failure mode —
// missing dir, unreadable file, malformed line — degrades to `false` (not
// resumable), which is the safe direction: never surface a resume that will break.

export function claudeProjectsDir(home: string = homedir()): string {
  return join(home, '.claude', 'projects')
}

// claude stores a transcript at ~/.claude/projects/<project-hash>/<id>.jsonl and
// creates it only when the session has content. We scan every project subdir for
// <id>.jsonl rather than derive the hash from cwd, so the check does not depend on
// claude's path-encoding scheme (which could differ for odd cwds).
export function claudeHasTranscript(sessionId: string, projectsDir: string = claudeProjectsDir()): boolean {
  let dirs: string[]
  try {
    dirs = readdirSync(projectsDir)
  } catch {
    return false // no projects dir → nothing resumable
  }
  for (const d of dirs) {
    const f = join(projectsDir, d, `${sessionId}.jsonl`)
    try {
      if (existsSync(f) && statSync(f).size > 0) return true
    } catch {
      // keep scanning other project dirs
    }
  }
  return false
}

// A codex rollout exists from spawn (before any message), so existence alone would
// false-positive an empty session. "Resumable" means the transcript records at
// least one user turn — an `event_msg` whose payload type is `user_message`.
export function codexRolloutHasContent(sessionId: string, sessionsDir: string = codexSessionsDir()): boolean {
  let entries: string[]
  try {
    entries = readdirSync(sessionsDir, { recursive: true }) as string[]
  } catch {
    return false
  }
  const idLc = sessionId.toLowerCase()
  for (const rel of entries) {
    const base = (rel.split(/[\\/]/).pop() ?? '').toLowerCase()
    if (!base.endsWith('.jsonl') || !base.includes(idLc)) continue
    try {
      const content = readFileSync(join(sessionsDir, rel), 'utf8')
      for (const line of content.split('\n')) {
        if (!line) continue
        try {
          const o = JSON.parse(line) as { type?: string; payload?: { type?: string } }
          if (o.type === 'event_msg' && o.payload?.type === 'user_message') return true
        } catch {
          // skip a malformed line; keep scanning the file
        }
      }
    } catch {
      // unreadable transcript → treat as no content
    }
    return false // this is the id's rollout; it had no user turn
  }
  return false // no rollout for this id
}

export function isConversationResumable(
  conv: { tool: string; agentSessionId: string | null },
  deps?: { claudeProjectsDir?: string; codexSessionsDir?: string }
): boolean {
  if (!conv.agentSessionId) return false
  if (conv.tool === 'claude') return claudeHasTranscript(conv.agentSessionId, deps?.claudeProjectsDir)
  if (conv.tool === 'codex') return codexRolloutHasContent(conv.agentSessionId, deps?.codexSessionsDir)
  // An unmodelled tool: we cannot disprove its resume, so trust the stored id.
  return true
}
