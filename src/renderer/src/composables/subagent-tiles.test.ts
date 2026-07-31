import { describe, it, expect } from 'vitest'
import {
  applySpawn,
  applyActivity,
  applyDone,
  formatActivityLine,
  tileStatus,
  sortTiles,
  filterTiles,
  relativeLabel,
  ACTIVE_MS,
  STALE_MS,
  type TileMap,
  type SubagentTile
} from './subagent-tiles'

const tile = (over: Partial<SubagentTile>): SubagentTile => ({
  agent: 'a', session: 's', agentType: '', description: '', lines: [], lastTs: 0, spawnedTs: 0, done: false, ...over
})

describe('formatActivityLine', () => {
  it('formats a tool call with a target', () => {
    expect(formatActivityLine({ kind: 'tool', tool: 'Read', target: '/a/b.ts' })).toBe('▸ Read /a/b.ts')
  })
  it('formats a tool call with no target and falls back to "tool"', () => {
    expect(formatActivityLine({ kind: 'tool' })).toBe('▸ tool')
    expect(formatActivityLine({ kind: 'tool', tool: 'Bash' })).toBe('▸ Bash')
  })
  it('formats thinking and text (trimmed)', () => {
    expect(formatActivityLine({ kind: 'thinking', text: '  pondering  ' })).toBe('… pondering')
    expect(formatActivityLine({ kind: 'text', text: '  hi  ' })).toBe('hi')
  })
})

describe('applySpawn / applyActivity / applyDone', () => {
  it('spawn creates a tile with type/description/session', () => {
    const map: TileMap = {}
    applySpawn(map, { session: 's1', agent: 'a1', agentType: 'Explore', description: 'look', ts: 100 })
    expect(map.a1).toMatchObject({ agent: 'a1', session: 's1', agentType: 'Explore', description: 'look', lastTs: 100, done: false, lines: [] })
  })

  it('activity appends a formatted line and advances lastTs', () => {
    const map: TileMap = {}
    applySpawn(map, { session: 's1', agent: 'a1', ts: 100 })
    applyActivity(map, { session: 's1', agent: 'a1', kind: 'tool', tool: 'Read', target: '/f', ts: 150 })
    applyActivity(map, { session: 's1', agent: 'a1', kind: 'text', text: 'done', ts: 160 })
    expect(map.a1.lines).toEqual(['▸ Read /f', 'done'])
    expect(map.a1.lastTs).toBe(160)
  })

  it('activity before spawn creates a minimal tile (ordering/backlog safety)', () => {
    const map: TileMap = {}
    applyActivity(map, { session: 's9', agent: 'orphan', kind: 'tool', tool: 'Grep', target: 'foo', ts: 5 })
    expect(map.orphan).toMatchObject({ agent: 'orphan', session: 's9', lines: ['▸ Grep foo'], lastTs: 5 })
  })

  it('caps the scrolling log to maxLines, dropping the oldest', () => {
    const map: TileMap = {}
    applySpawn(map, { session: 's', agent: 'a', ts: 0 })
    for (let i = 1; i <= 5; i++) applyActivity(map, { session: 's', agent: 'a', kind: 'text', text: `l${i}`, ts: i }, 3)
    expect(map.a.lines).toEqual(['l3', 'l4', 'l5']) // kept the newest 3
  })

  it('done marks the tile finished; later activity revives it', () => {
    const map: TileMap = {}
    applySpawn(map, { session: 's', agent: 'a', ts: 0 })
    applyDone(map, { session: 's', agent: 'a', ts: 10 })
    expect(map.a.done).toBe(true)
    applyActivity(map, { session: 's', agent: 'a', kind: 'text', text: 'more', ts: 20 })
    expect(map.a.done).toBe(false)
  })

  it('done for an unknown agent is a no-op', () => {
    const map: TileMap = {}
    applyDone(map, { session: 's', agent: 'ghost', ts: 1 })
    expect(map.ghost).toBeUndefined()
  })
})

describe('tileStatus', () => {
  it('done wins over recency', () => {
    expect(tileStatus(tile({ done: true, lastTs: 1000 }), 1000)).toBe('done')
  })
  it('active within ACTIVE_MS, idle up to STALE_MS, stale beyond', () => {
    const now = 1_000_000
    expect(tileStatus(tile({ lastTs: now - (ACTIVE_MS - 1) }), now)).toBe('active')
    expect(tileStatus(tile({ lastTs: now - (ACTIVE_MS + 1) }), now)).toBe('idle')
    expect(tileStatus(tile({ lastTs: now - (STALE_MS + 1) }), now)).toBe('stale')
  })
})

describe('sortTiles', () => {
  it('orders most-recently-active first, stable on agent id', () => {
    const tiles = [tile({ agent: 'a', lastTs: 10 }), tile({ agent: 'b', lastTs: 30 }), tile({ agent: 'c', lastTs: 30 })]
    expect(sortTiles(tiles).map((t) => t.agent)).toEqual(['b', 'c', 'a'])
  })
})

describe('filterTiles (this app only)', () => {
  const tiles = [tile({ agent: 'a', session: 'known' }), tile({ agent: 'b', session: 'other' })]
  it('passes everything when appOnly is off', () => {
    expect(filterTiles(tiles, false, new Set(['known'])).map((t) => t.agent)).toEqual(['a', 'b'])
  })
  it('keeps only tiles whose session is in the known set when appOnly is on', () => {
    expect(filterTiles(tiles, true, new Set(['known'])).map((t) => t.agent)).toEqual(['a'])
  })
})

describe('relativeLabel', () => {
  it('renders now/seconds/minutes/hours', () => {
    expect(relativeLabel(1000, 1000)).toBe('now')
    expect(relativeLabel(1000, 6000)).toBe('5s')
    expect(relativeLabel(0, 3 * 60_000)).toBe('3m')
    expect(relativeLabel(0, 2 * 60 * 60_000)).toBe('2h')
  })
})
