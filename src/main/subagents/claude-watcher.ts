import chokidar from 'chokidar'
import { EventEmitter } from 'node:events'
import { openSync, readSync, closeSync, statSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, basename } from 'node:path'
import type { SubagentActivityPayload, SubagentWatcher } from './types'

// Ported from racconsole/src/watcher.mjs. Passively tails Claude Code subagent
// transcripts under ~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl
// and emits 'spawn' and 'activity' events. Read-only; never writes to the watched
// tree. GLOBAL — every subagent it sees is emitted; app-scoping happens downstream.

// racconsole: export const PROJECTS = join(homedir(), '.claude', 'projects')
// Made injectable for tests; matches session-resumable.ts's claudeProjectsDir join.
export function claudeProjectsDir(home: string = homedir()): string {
  return join(home, '.claude', 'projects')
}

// racconsole path helpers, preserved verbatim (regex + logic).
export const isSubagent = (p: string): boolean =>
  /[\\/]subagents[\\/]agent-[^\\/]+\.jsonl$/.test(p)

export const agentOf = (p: string): string =>
  basename(p).replace(/^agent-/, '').replace(/\.jsonl$/, '')

export function sessionOf(p: string): string {
  const parts = p.split(/[\\/]/)
  const i = parts.indexOf('subagents')
  return i > 0 ? parts[i - 1] : '?'
}

// The pure "line handler" core, factored out of racconsole's handleLine so it is
// unit-testable without a real file watch. Returns the activity payloads a single
// transcript line yields (session/agent/ts are stamped by the watcher on emit).
// A non-assistant line, a parse failure, or non-array content yields [].
export function parseClaudeAssistantLine(line: string): SubagentActivityPayload[] {
  let obj: { type?: string; message?: { content?: unknown } }
  try {
    obj = JSON.parse(line) as typeof obj
  } catch {
    return []
  }
  if (obj.type !== 'assistant') return []
  const content = obj.message?.content
  if (!Array.isArray(content)) return []
  const out: SubagentActivityPayload[] = []
  for (const item of content as Array<Record<string, unknown>>) {
    if (!item || typeof item !== 'object') continue
    if (item.type === 'tool_use') {
      const inp = (item.input ?? {}) as Record<string, unknown>
      const target =
        (inp.file_path as string) ||
        (inp.path as string) ||
        (inp.pattern as string) ||
        (inp.command ? String(inp.command).replace(/\s+/g, ' ').slice(0, 60) : '')
      out.push({ kind: 'tool', tool: item.name as string, target })
    } else if (item.type === 'text' && typeof item.text === 'string' && item.text.trim()) {
      out.push({ kind: 'text', text: item.text.trim() })
    } else if (item.type === 'thinking' && typeof item.thinking === 'string' && item.thinking.trim()) {
      out.push({ kind: 'thinking', text: item.thinking.trim() })
    }
  }
  return out
}

export function createClaudeSubagentWatcher(opts?: { projectsDir?: string }): SubagentWatcher {
  const PROJECTS = opts?.projectsDir ?? claudeProjectsDir()
  const em = new EventEmitter() as SubagentWatcher
  const offsets = new Map<string, number>() // filePath -> bytes consumed
  const partials = new Map<string, string>() // filePath -> leftover partial line
  const active = new Map<string, number>() // filePath -> last-growth ms; polled as a safety net for missed chokidar events
  const POLL_MS = 1500
  const ACTIVE_TTL_MS = 60000
  const BACKLOG_WINDOW_MS = 2 * 60 * 1000 // on startup, replay subagents active within this window

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
    } // first sighting via change: skip backlog
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
    const data = (partials.get(p) ?? '') + buf.toString('utf8')
    const lines = data.split('\n')
    partials.set(p, lines.pop() ?? '')
    for (const line of lines) if (line.trim()) handleLine(p, line)
  }

  function handleLine(p: string, line: string): void {
    const payloads = parseClaudeAssistantLine(line)
    if (payloads.length === 0) return
    const session = sessionOf(p)
    const agent = agentOf(p)
    for (const payload of payloads) {
      em.emit('activity', { session, agent, ts: Date.now(), ...payload })
    }
  }

  function onNewAgent(p: string): void {
    let agentType = '',
      description = ''
    try {
      const m = JSON.parse(readFileSync(p.replace(/\.jsonl$/, '.meta.json'), 'utf8')) as {
        agentType?: string
        description?: string
      }
      agentType = m.agentType ?? ''
      description = m.description ?? ''
    } catch {
      // no sibling meta → empty agentType/description
    }
    em.emit('spawn', { session: sessionOf(p), agent: agentOf(p), agentType, description, ts: Date.now() })
    offsets.set(p, 0)
    active.set(p, Date.now())
    readNew(p)
  }

  // On startup chokidar skips existing files (ignoreInitial). Replay subagents
  // that are still recently active so opening the app mid-fan-out shows the
  // workers already running, then tail them going forward.
  function loadBacklog(): void {
    const cutoff = Date.now() - BACKLOG_WINDOW_MS
    let projs
    try {
      projs = readdirSync(PROJECTS, { withFileTypes: true })
    } catch {
      return
    }
    for (const proj of projs) {
      if (!proj.isDirectory()) continue
      let sessions
      try {
        sessions = readdirSync(join(PROJECTS, proj.name), { withFileTypes: true })
      } catch {
        continue
      }
      for (const sess of sessions) {
        if (!sess.isDirectory()) continue
        const subDir = join(PROJECTS, proj.name, sess.name, 'subagents')
        let names
        try {
          names = readdirSync(subDir)
        } catch {
          continue
        }
        for (const name of names) {
          if (!/^agent-.*\.jsonl$/.test(name)) continue
          const p = join(subDir, name)
          if (offsets.has(p)) continue // chokidar already picked it up
          let st
          try {
            st = statSync(p)
          } catch {
            continue
          }
          if (st.mtimeMs < cutoff) continue // too old to be in-flight
          onNewAgent(p) // spawn + replay history, then tail
        }
      }
    }
  }

  const watcher = chokidar.watch(PROJECTS, {
    ignoreInitial: true,
    ignored: (p: string) => p.includes('node_modules'),
    depth: 6
  })
  watcher.on('add', (p: string) => {
    if (isSubagent(p)) onNewAgent(p)
  })
  watcher.on('change', (p: string) => {
    if (isSubagent(p)) readNew(p)
  })
  watcher.on('error', (e: unknown) => em.emit('error', e instanceof Error ? e : new Error(String(e))))
  watcher.on('ready', () => {
    loadBacklog()
    em.emit('ready')
  })

  // Safety net: chokidar can coalesce or drop the final 'change' when an agent
  // exits right after its last write. Re-stat recently-active files and read any
  // growth we missed; stop polling a file once it has been quiet past the TTL.
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
