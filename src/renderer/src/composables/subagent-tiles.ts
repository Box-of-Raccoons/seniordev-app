import type { SubagentSpawnEvent, SubagentActivityEvent, SubagentDoneEvent } from '../../../shared/ipc'

// Pure, DOM-free tile logic for the S8 subagent panel. The composable
// (useSubagents) owns the reactive record + IPC subscription + clock; the
// assembly, formatting, status derivation, sort, and app-scope filter live here
// so they are unit-testable without a real event feed. Mirrors sidebar-logic.ts.

export interface SubagentTile {
  agent: string // the subagent id (tile key); for codex, equals session
  session: string // the parent Claude session id (codex: same as agent)
  agentType: string // e.g. 'general-purpose', 'Explore', 'Codex' ('' if unknown)
  description: string // the spawn's task description, if any
  lines: string[] // scrolling activity log, most-recent LAST
  lastTs: number // ms of the last spawn/activity/done — drives status + sort
  spawnedTs: number // ms of the spawn (or first sighting)
  done: boolean // codex task_complete (claude has no reliable done signal)
}

// Status is derived from how long a tile has been quiet, mirroring racconsole's
// tiers (there is no reliable "done" for claude subagents, so quiet time stands
// in for "still running"). `done` (codex task_complete) wins over the tiers.
export type SubagentStatus = 'active' | 'idle' | 'stale' | 'done'
export const ACTIVE_MS = 20_000 // quiet <= 20s ⇒ active
export const STALE_MS = 90_000 // quiet  > 90s ⇒ stale (likely finished/abandoned; faded)
export const REMOVE_MS = 180_000 // quiet  > 3min ⇒ auto-removed (the panel self-cleans)
export const MAX_LINES = 100 // cap a tile's scrolling log

export type TileMap = Record<string, SubagentTile>

// A one-line label for an activity event: "▸ Read src/x.ts", "… thinking…", or a
// text snippet. Kept short; the panel ellipsizes overflow with CSS.
export function formatActivityLine(
  e: Pick<SubagentActivityEvent, 'kind' | 'tool' | 'target' | 'text'>
): string {
  if (e.kind === 'tool') return `▸ ${e.tool || 'tool'}${e.target ? ' ' + e.target : ''}`
  if (e.kind === 'thinking') return `… ${(e.text || '').trim()}`.trim()
  return (e.text || '').trim()
}

// Create/reset a tile for a spawn. A reused agent id (rare) resets its log — a
// new spawn is a new run.
export function applySpawn(map: TileMap, e: SubagentSpawnEvent): TileMap {
  map[e.agent] = {
    agent: e.agent,
    session: e.session,
    agentType: e.agentType || '',
    description: e.description || '',
    lines: [],
    lastTs: e.ts,
    spawnedTs: e.ts,
    done: false
  }
  return map
}

// Append an activity line to a tile, creating a minimal tile if the activity
// arrives before its spawn (possible via backlog replay / event ordering).
export function applyActivity(map: TileMap, e: SubagentActivityEvent, maxLines = MAX_LINES): TileMap {
  const line = formatActivityLine(e)
  const tile =
    map[e.agent] ??
    (map[e.agent] = {
      agent: e.agent,
      session: e.session,
      agentType: '',
      description: '',
      lines: [],
      lastTs: e.ts,
      spawnedTs: e.ts,
      done: false
    })
  if (line) {
    tile.lines.push(line)
    if (tile.lines.length > maxLines) tile.lines.splice(0, tile.lines.length - maxLines)
  }
  tile.lastTs = Math.max(tile.lastTs, e.ts)
  tile.done = false // fresh activity ⇒ it is running again
  return map
}

// Mark a tile finished (codex task_complete). Unknown agent ⇒ no-op.
export function applyDone(map: TileMap, e: SubagentDoneEvent): TileMap {
  const tile = map[e.agent]
  if (tile) {
    tile.done = true
    tile.lastTs = Math.max(tile.lastTs, e.ts)
  }
  return map
}

// Drop tiles that have been quiet past REMOVE_MS so the panel self-cleans to
// "what's running now" without needing a manual Clear. Mutates + returns the map.
export function pruneStale(map: TileMap, now: number, removeMs = REMOVE_MS): TileMap {
  for (const [k, t] of Object.entries(map)) {
    if (now - t.lastTs > removeMs) delete map[k]
  }
  return map
}

export function tileStatus(tile: Pick<SubagentTile, 'done' | 'lastTs'>, now: number): SubagentStatus {
  if (tile.done) return 'done'
  const quiet = now - tile.lastTs
  if (quiet <= ACTIVE_MS) return 'active'
  if (quiet <= STALE_MS) return 'idle'
  return 'stale'
}

// Most-recently-active first; a stable tiebreak on agent id keeps equal
// timestamps from reordering between ticks.
export function sortTiles(tiles: SubagentTile[]): SubagentTile[] {
  return tiles
    .slice()
    .sort((a, b) => b.lastTs - a.lastTs || (a.agent < b.agent ? -1 : a.agent > b.agent ? 1 : 0))
}

// The "this app only" filter: keep tiles whose parent session was launched by
// this app (its id is in the known set). When appOnly is off, keep everything.
export function filterTiles(tiles: SubagentTile[], appOnly: boolean, knownSessions: Set<string>): SubagentTile[] {
  if (!appOnly) return tiles
  return tiles.filter((t) => knownSessions.has(t.session))
}

// A compact relative-time label ("now", "5s", "3m", "2h").
export function relativeLabel(ts: number, now: number): string {
  const secs = Math.max(0, Math.round((now - ts) / 1000))
  if (secs < 1) return 'now'
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h`
}
