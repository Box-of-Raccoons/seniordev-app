import { describe, it, expect } from 'vitest'
import {
  searchClaudeTranscript,
  searchCodexTranscript,
  searchTranscript,
  excerptAround,
  EXCERPT_MAX
} from './transcript-search'

const userLine = (text: string): string => JSON.stringify({ type: 'user', message: { content: text } })
const agentLine = (text: string): string =>
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } })

describe('excerptAround', () => {
  it('collapses whitespace to one line', () => {
    expect(excerptAround('a\n\n  b\tc', 0).excerpt).toBe('a b c')
  })

  it('returns a short turn whole', () => {
    expect(excerptAround('short one', 6).excerpt).toBe('short one')
  })

  it('WINDOWS around the match so a late hit is still visible', () => {
    const text = 'x'.repeat(500) + 'NEEDLE' + 'y'.repeat(500)
    const { excerpt } = excerptAround(text, 500)
    expect(excerpt).toContain('NEEDLE')
    expect(excerpt.length).toBeLessThanOrEqual(EXCERPT_MAX + 2)
  })

  it('marks a windowed excerpt with ellipses on the trimmed sides', () => {
    const text = 'x'.repeat(500) + 'NEEDLE' + 'y'.repeat(500)
    const { excerpt } = excerptAround(text, 500)
    expect(excerpt.startsWith('…')).toBe(true)
    expect(excerpt.endsWith('…')).toBe(true)
  })

  it('reports an offset that actually points at the match', () => {
    const text = 'x'.repeat(500) + 'NEEDLE' + 'y'.repeat(500)
    const { excerpt, offset } = excerptAround(text, 500)
    expect(excerpt.slice(offset, offset + 6)).toBe('NEEDLE')
  })
})

describe('searchClaudeTranscript', () => {
  it('returns nothing for an empty query', () => {
    expect(searchClaudeTranscript(userLine('anything'), '')).toEqual([])
    expect(searchClaudeTranscript(userLine('anything'), '   ')).toEqual([])
  })

  it('finds a user turn', () => {
    const hits = searchClaudeTranscript(userLine('fix the sync comparator'), 'comparator')
    expect(hits).toHaveLength(1)
    expect(hits[0].role).toBe('user')
    expect(hits[0].excerpt).toContain('comparator')
  })

  it('finds an AGENT turn too, so "which session hit that error" is answerable', () => {
    const hits = searchClaudeTranscript(agentLine('TypeError: cannot read x'), 'typeerror')
    expect(hits).toHaveLength(1)
    expect(hits[0].role).toBe('agent')
  })

  it('is case-insensitive', () => {
    expect(searchClaudeTranscript(userLine('Sync Comparator'), 'sync comparator')).toHaveLength(1)
  })

  it('treats the query as text, not a regex, so punctuation cannot throw', () => {
    expect(() => searchClaudeTranscript(userLine('a (b) c'), '(b)')).not.toThrow()
    expect(searchClaudeTranscript(userLine('a (b) c'), '(b)')).toHaveLength(1)
  })

  it('skips isMeta records, which are harness bookkeeping not conversation', () => {
    const line = JSON.stringify({ type: 'user', isMeta: true, message: { content: 'needle' } })
    expect(searchClaudeTranscript(line, 'needle')).toEqual([])
  })

  it('skips system-injected user content wrapped in angle tags', () => {
    // A command envelope is not something the human said; matching it would be
    // a false positive on "which session did I ask about X".
    expect(searchClaudeTranscript(userLine('<command-name>needle</command-name>'), 'needle')).toEqual([])
  })

  it('still matches angle-tagged AGENT text, which is real output', () => {
    expect(searchClaudeTranscript(agentLine('<div>needle</div>'), 'needle')).toHaveLength(1)
  })

  it('numbers turns in order', () => {
    const hits = searchClaudeTranscript([userLine('needle one'), agentLine('needle two')].join('\n'), 'needle')
    expect(hits.map((h) => h.turn)).toEqual([1, 2])
  })

  it('honours the result limit', () => {
    const many = Array.from({ length: 50 }, (_, i) => userLine(`needle ${i}`)).join('\n')
    expect(searchClaudeTranscript(many, 'needle', 5)).toHaveLength(5)
  })

  it('skips malformed lines rather than throwing', () => {
    expect(searchClaudeTranscript(['not json', userLine('needle'), '{'].join('\n'), 'needle')).toHaveLength(1)
  })

  it('ignores records with no text content', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } })
    expect(searchClaudeTranscript(line, 'bash')).toEqual([])
  })
})

describe('searchCodexTranscript', () => {
  const codexUser = (m: string): string => JSON.stringify({ payload: { type: 'user_message', message: m } })
  const codexAgent = (m: string): string => JSON.stringify({ payload: { type: 'agent_message', message: m } })

  it('finds a user turn', () => {
    const hits = searchCodexTranscript(codexUser('run the migration'), 'migration')
    expect(hits[0].role).toBe('user')
  })

  it('finds an agent turn', () => {
    const hits = searchCodexTranscript(codexAgent('migration failed'), 'migration')
    expect(hits[0].role).toBe('agent')
  })

  it('ignores payload types that are not conversation', () => {
    const line = JSON.stringify({ payload: { type: 'turn_context', message: 'needle' } })
    expect(searchCodexTranscript(line, 'needle')).toEqual([])
  })

  it('skips malformed lines', () => {
    expect(searchCodexTranscript(['garbage', codexUser('needle')].join('\n'), 'needle')).toHaveLength(1)
  })
})

describe('searchTranscript', () => {
  it('routes claude', () => {
    expect(searchTranscript('claude', userLine('needle'), 'needle')).toHaveLength(1)
  })

  it('routes codex', () => {
    const line = JSON.stringify({ payload: { type: 'user_message', message: 'needle' } })
    expect(searchTranscript('codex', line, 'needle')).toHaveLength(1)
  })

  it('reports nothing for an unknown tool rather than grepping raw JSON', () => {
    // Matching raw JSON would surface field names as "hits".
    expect(searchTranscript('some-other-agent', userLine('needle'), 'needle')).toEqual([])
  })
})
