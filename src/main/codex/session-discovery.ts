import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// Codex has no launch-time flag to set a session id (unlike claude's --session-id),
// so SeniorDev discovers it AFTER spawning. Codex writes a per-session transcript
// at ~/.codex/sessions/YYYY/MM/DD/rollout-<ISO>-<UUID>.jsonl, and the session id
// is the UUID in the filename (verified this machine 2026-07-30). This is a pure
// `fs` scan — no sqlite (the app's Electron 20 runtime has no node:sqlite, and a
// native module is banned by design), no CLI dependency, cross-platform, and it
// depends on a more stable contract than the churning state_5.sqlite schema.
//
// Robustness contract (spec section 7.1): a missing directory, no files, a
// malformed transcript, or a cwd mismatch all resolve to null — "no resume
// available for this conversation" — and never to an error.

// The codex home; overridable for tests. Default ~/.codex/sessions.
export function codexSessionsDir(home: string = homedir()): string {
  return join(home, '.codex', 'sessions')
}

// Codex ids are UUIDv7: the first 48 bits are the creation time in ms, and that
// value is bit-identical to the row's created_at_ms (verified on real ids). We
// decode the id itself rather than trust a column or the local-time filename, so
// the filter survives a schema/column rename and is timezone-independent.
export function decodeUuidV7Ms(uuid: string): number | null {
  const hex = uuid.replace(/-/g, '')
  if (!/^[0-9a-f]{32}$/i.test(hex)) return null
  const ms = parseInt(hex.slice(0, 12), 16)
  return Number.isFinite(ms) ? ms : null
}

const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
// rollout-2026-07-29T00-53-31-019fac38-7f16-7f90-b118-c9ba0cef3d8d.jsonl
// Both the ISO stamp and the UUID contain hyphens; anchor on the trailing UUID
// immediately before .jsonl so the id is unambiguous.
const ROLLOUT_RE = new RegExp(`^rollout-.*-${UUID.source}\\.jsonl$`, 'i')

export function parseRolloutFilename(name: string): { uuid: string; tsMs: number } | null {
  const m = ROLLOUT_RE.exec(name)
  if (!m) return null
  const uuid = m[1].toLowerCase()
  const tsMs = decodeUuidV7Ms(uuid)
  return tsMs === null ? null : { uuid, tsMs }
}

// A codex rollout's first line is a `session_meta` record carrying the cwd. Read
// only that line; a matched file is freshly created (its decoded ts is in our
// window) so it is small. Any read/parse failure → null (treated as no match).
function readCwdFromMeta(file: string): string | null {
  try {
    const raw = readFileSync(file, 'utf8')
    const nl = raw.indexOf('\n')
    const firstLine = nl === -1 ? raw : raw.slice(0, nl)
    const obj = JSON.parse(firstLine) as { payload?: { cwd?: unknown } }
    const cwd = obj?.payload?.cwd
    return typeof cwd === 'string' ? cwd : null
  } catch {
    return null
  }
}

// Trailing-separator-insensitive path compare. codex records the same cwd string
// SeniorDev spawned it with, so an exact (trimmed) compare is right; we do not
// lowercase, to stay correct on case-sensitive POSIX filesystems.
function sameCwd(a: string, b: string): boolean {
  const norm = (p: string): string => p.replace(/[\\/]+$/, '')
  return norm(a) === norm(b)
}

export interface FindRolloutOpts {
  sessionsDir: string
  cwd: string
  // Inclusive creation-time window (ms), decoded from the id. Anchor `since` at
  // spawn: the rollout file's id-timestamp is its creation time, which is at (or
  // shortly after) spawn — earlier than prompt submission.
  since: number
  until: number
}

// The newest rollout whose decoded creation time is in [since, until] AND whose
// session_meta cwd matches. Newest-first so a cwd-confirmed match wins; null when
// nothing qualifies or the directory is unreadable.
export function findRolloutSession(opts: FindRolloutOpts): string | null {
  let entries: string[]
  try {
    entries = readdirSync(opts.sessionsDir, { recursive: true }) as string[]
  } catch {
    return null // missing / unreadable sessions dir → no resume available
  }
  const candidates: { uuid: string; tsMs: number; file: string }[] = []
  for (const rel of entries) {
    const base = rel.split(/[\\/]/).pop() ?? ''
    const parsed = parseRolloutFilename(base)
    if (!parsed) continue
    if (parsed.tsMs < opts.since || parsed.tsMs > opts.until) continue
    candidates.push({ uuid: parsed.uuid, tsMs: parsed.tsMs, file: join(opts.sessionsDir, rel) })
  }
  candidates.sort((a, b) => b.tsMs - a.tsMs)
  for (const c of candidates) {
    const cwd = readCwdFromMeta(c.file)
    if (cwd && sameCwd(cwd, opts.cwd)) return c.uuid
  }
  return null
}

export interface PollOpts {
  sessionsDir: string
  cwd: string
  // Spawn time (ms). The window opens here, minus a small slack for clock skew.
  since: number
  intervalMs?: number
  timeoutMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

// Poll for the rollout file to appear, from spawn until it is found or the timeout
// trips. Tolerates the readiness wait ahead of prompt delivery (which has its own
// 15s valve). Returns the session id, or null on timeout / any degradation — the
// caller treats null as "this codex conversation has no resume available", which
// is also the correct answer for a session where nothing was ever run.
export async function pollForCodexSession(opts: PollOpts): Promise<string | null> {
  const interval = opts.intervalMs ?? 500
  const timeout = opts.timeoutMs ?? 20000
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? ((ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)))
  const SLACK = 2000 // clock skew between our timer and the id's embedded ts
  const since = opts.since - SLACK
  const deadline = now() + timeout
  for (;;) {
    const id = findRolloutSession({ sessionsDir: opts.sessionsDir, cwd: opts.cwd, since, until: now() + SLACK })
    if (id) return id
    if (now() >= deadline) return null
    await sleep(interval)
  }
}
