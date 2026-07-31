import chokidar from 'chokidar'
import { EventEmitter } from 'node:events'
import { openSync, readSync, closeSync, statSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, basename } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { SubagentActivityPayload, SubagentWatcher } from './types'

// Ported from racconsole/src/codex.mjs (the module core only — its CLI `main()`
// replay block is intentionally omitted). Tails ~/.codex/sessions rollout
// transcripts and emits the same spawn/activity events as the claude watcher, so
// a Codex session renders as a single tile. Read-only. A Codex session has no
// subagents, so session id === agent id. GLOBAL — no app-scoping here.

// racconsole: export const CODEX_SESSIONS = join(homedir(), '.codex', 'sessions')
// Made injectable for tests; matches session-discovery.ts's codexSessionsDir join.
export function codexSessionsDir(home: string = homedir()): string {
  return join(home, '.codex', 'sessions')
}

export const isRollout = (name: string): boolean => /rollout-.*\.jsonl$/.test(name)

export function codexIdOf(p: string): string {
  const m = basename(p).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i)
  return m ? m[1] : basename(p).replace(/\.jsonl$/, '')
}

function patchTarget(input: unknown): string {
  const m = String(input ?? '').match(/\*\*\* (?:Add|Update|Delete) File: (.+)/)
  return m ? m[1].trim() : ''
}

// The result of parsing one rollout line: an activity payload, a done marker, or
// null (line carried nothing we surface). Kept as a discriminated union so the
// watcher can branch on kind:'done' before emitting.
export type CodexLineResult = SubagentActivityPayload | { kind: 'done' } | null

// Map one rollout line to a Racconsole activity ({kind,...}) or null. Ported
// verbatim from codex.mjs; exported for unit testing.
export function parseCodexLine(line: string): CodexLineResult {
  let obj: { payload?: Record<string, unknown> } & Record<string, unknown>
  try {
    obj = JSON.parse(line) as typeof obj
  } catch {
    return null
  }
  const pl = (obj.payload ?? obj) as Record<string, unknown>
  switch (pl?.type) {
    case 'function_call': {
      let cmd = ''
      try {
        cmd = JSON.parse((pl.arguments as string) || '{}').command || ''
      } catch {
        // malformed arguments → empty command
      }
      return {
        kind: 'tool',
        tool: (pl.name as string) || 'call',
        target: String(cmd).replace(/\s+/g, ' ').slice(0, 60)
      }
    }
    case 'custom_tool_call':
      if (pl.name === 'apply_patch') return { kind: 'tool', tool: 'apply_patch', target: patchTarget(pl.input) }
      return null
    case 'agent_message':
      return typeof pl.message === 'string' && pl.message.trim() ? { kind: 'text', text: pl.message.trim() } : null
    case 'message': {
      if (pl.role !== 'assistant' || !Array.isArray(pl.content)) return null
      const txt = (pl.content as Array<{ type?: string; text?: string }>).find((c) => c?.type === 'output_text')?.text
      return txt?.trim() ? { kind: 'text', text: txt.trim() } : null
    }
    case 'task_complete':
      return { kind: 'done' }
    default:
      return null
  }
}

export function createCodexSubagentWatcher(opts?: { sessionsDir?: string }): SubagentWatcher {
  const CODEX_SESSIONS = opts?.sessionsDir ?? codexSessionsDir()
  const em = new EventEmitter() as SubagentWatcher
  const offsets = new Map<string, number>()
  const partials = new Map<string, string>()
  const decoders = new Map<string, StringDecoder>()
  const active = new Map<string, number>()
  const seen = new Set<string>()
  const lastText = new Map<string, string>() // session -> last emitted text; dedupes Codex's agent_message/message mirror
  const POLL_MS = 1500,
    ACTIVE_TTL_MS = 60000,
    BACKLOG_WINDOW_MS = 5 * 60 * 1000

  function spawnOnce(p: string): void {
    if (seen.has(p)) return
    seen.add(p)
    em.emit('spawn', { session: codexIdOf(p), agent: codexIdOf(p), agentType: 'Codex', description: '', ts: Date.now() })
  }

  function readNew(p: string): void {
    let stat
    try {
      stat = statSync(p)
    } catch {
      return
    }
    if (!offsets.has(p)) {
      offsets.set(p, stat.size)
      return
    }
    const prev = offsets.get(p) ?? 0
    if (stat.size <= prev) {
      offsets.set(p, stat.size)
      return
    }
    const len = stat.size - prev
    const buf = Buffer.allocUnsafe(len)
    const fd = openSync(p, 'r')
    try {
      readSync(fd, buf, 0, len, prev)
    } finally {
      closeSync(fd)
    }
    offsets.set(p, stat.size)
    active.set(p, Date.now())
    let dec = decoders.get(p)
    if (!dec) {
      dec = new StringDecoder('utf8')
      decoders.set(p, dec)
    }
    const data = (partials.get(p) ?? '') + dec.write(buf)
    const lines = data.split('\n')
    partials.set(p, lines.pop() ?? '')
    const session = codexIdOf(p)
    for (const line of lines) {
      if (!line.trim()) continue
      const ev = parseCodexLine(line)
      if (!ev) continue
      if (ev.kind === 'done') {
        em.emit('done', { session, agent: session, ts: Date.now() })
        continue
      }
      if (ev.kind === 'text') {
        if (lastText.get(session) === ev.text) continue
        lastText.set(session, ev.text ?? '')
      }
      em.emit('activity', { session, agent: session, ts: Date.now(), ...ev })
    }
  }

  function onRollout(p: string, fromStart: boolean): void {
    spawnOnce(p)
    active.set(p, Date.now())
    let size = 0
    try {
      size = statSync(p).size
    } catch {
      // unreadable → treat as empty; tail from 0
    }
    offsets.set(p, fromStart ? 0 : size)
    if (fromStart) readNew(p)
  }

  // On startup, replay rollouts active within the window (Codex has no "add" for
  // existing files under ignoreInitial), then tail.
  function loadBacklog(): void {
    const cutoff = Date.now() - BACKLOG_WINDOW_MS
    const walk = (dir: string): void => {
      let ents
      try {
        ents = readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of ents) {
        const full = join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (e.isFile() && isRollout(e.name)) {
          let st
          try {
            st = statSync(full)
          } catch {
            continue
          }
          if (st.mtimeMs >= cutoff && !offsets.has(full)) onRollout(full, true)
        }
      }
    }
    walk(CODEX_SESSIONS)
  }

  const watcher = chokidar.watch(CODEX_SESSIONS, { ignoreInitial: true, depth: 6 })
  watcher.on('add', (p: string) => {
    if (isRollout(basename(p))) onRollout(p, true)
  })
  watcher.on('change', (p: string) => {
    if (isRollout(basename(p))) readNew(p)
  })
  watcher.on('error', (e: unknown) => em.emit('error', e instanceof Error ? e : new Error(String(e))))
  watcher.on('ready', () => {
    loadBacklog()
    em.emit('ready')
  })

  const poll = setInterval(() => {
    const now = Date.now()
    for (const p of active.keys()) {
      if (now - (active.get(p) ?? 0) > ACTIVE_TTL_MS) active.delete(p)
      else readNew(p)
    }
  }, POLL_MS)

  em.close = (): void => {
    clearInterval(poll)
    void watcher.close()
  }
  return em
}
