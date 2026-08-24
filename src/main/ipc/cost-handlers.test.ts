import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'

const handlers = new Map<string, (...a: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => handlers.set(ch, fn) }
}))

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { registerCostIpc, resolveRates } from './cost-handlers'
import { COST, type ConversationCostInfo } from '../../shared/ipc'
import { DEFAULT_RATES } from '../cost/pricing'
import type { SessionPersistence } from '../session-persistence'
import type { ConfigSource } from '../config/store'

beforeEach(() => handlers.clear())

describe('resolveRates', () => {
  it('uses the bundled table when config says nothing', () => {
    expect(resolveRates(null)['claude-opus-5']).toEqual({ input: 5, output: 25 })
  })

  it('merges config OVER the defaults without dropping the rest', () => {
    const r = resolveRates({ modelRates: { 'claude-opus-5': { input: 7, output: 30 } } })
    expect(r['claude-opus-5']).toEqual({ input: 7, output: 30 })
    // Everything else survives the override.
    expect(r['claude-haiku-4-5']).toEqual(DEFAULT_RATES['claude-haiku-4-5'])
  })

  it('lets config add a model the bundled table has never heard of', () => {
    expect(resolveRates({ modelRates: { 'brand-new': { input: 1, output: 2 } } })['brand-new']).toEqual({
      input: 1,
      output: 2
    })
  })
})

// A real transcript tree, since the handler's job includes finding the file.
let root: string
const WITH_USAGE = 'dddddddd-4444-4444-8444-dddddddddddd'

const SIDECHAIN = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee'
const UNPRICED = 'ffffffff-6666-4666-8666-ffffffffffff'

const line = (model: string, usage: Record<string, unknown>, sidechain = false, id = 'm1'): string =>
  JSON.stringify({ type: 'assistant', isSidechain: sidechain, message: { id, model, usage } })

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'seniordev-cost-ipc-'))
  mkdirSync(join(root, 'p-root', 'proj'), { recursive: true })
  mkdirSync(join(root, 'codex'), { recursive: true })

  // Main session on Opus 5 plus a subagent turn on Haiku, so the split is
  // observable in the wire shape rather than assumed.
  writeFileSync(
    join(root, 'p-root', 'proj', `${WITH_USAGE}.jsonl`),
    [
      line('claude-opus-5', { input_tokens: 1_000_000, output_tokens: 0 }, false, 'm1'),
      line('claude-haiku-4-5', { input_tokens: 1_000_000, output_tokens: 0 }, true, 'm2')
    ].join('\n')
  )
  writeFileSync(
    join(root, 'p-root', 'proj', `${SIDECHAIN}.jsonl`),
    line('claude-opus-5', { output_tokens: 200 }, false, 'm3')
  )
  writeFileSync(
    join(root, 'p-root', 'proj', `${UNPRICED}.jsonl`),
    [
      line('claude-opus-5', { output_tokens: 1000 }, false, 'm4'),
      line('brand-new-model', { output_tokens: 1000 }, false, 'm5')
    ].join('\n')
  )
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

type Conv = { id: string; tool: string; agentSessionId: string | null }

// The fixture tree is wired in via the directory seam, so the handler's real
// work (locate, read, parse, price, map) is exercised rather than skipped.
function setup(conversations: Conv[], modelRates?: Record<string, { input: number; output: number }>): void {
  const persistence = { conversations: { list: () => conversations } } as unknown as SessionPersistence
  const source = { config: modelRates ? { modelRates } : {} } as unknown as ConfigSource
  registerCostIpc({
    persistence,
    source,
    claudeProjectsDir: join(root, 'p-root'),
    codexSessionsDir: join(root, 'codex')
  })
}

describe(COST.list, () => {
  it('omits conversations whose agent produced no tokens', async () => {
    setup([{ id: 'c1', tool: 'claude', agentSessionId: null }])
    expect(await handlers.get(COST.list)!()).toEqual([])
  })

  it('omits a conversation whose transcript cannot be found', async () => {
    setup([{ id: 'c1', tool: 'claude', agentSessionId: 'missing-id' }])
    expect(await handlers.get(COST.list)!()).toEqual([])
  })

  it('never throws when the transcript tree does not exist', () => {
    const persistence = {
      conversations: { list: () => [{ id: 'c1', tool: 'claude', agentSessionId: WITH_USAGE }] }
    } as unknown as SessionPersistence
    registerCostIpc({
      persistence,
      source: { config: {} } as unknown as ConfigSource,
      // A directory that genuinely is not there, rather than the real HOME,
      // which on this machine does have transcripts and proves nothing.
      claudeProjectsDir: join(root, 'definitely-absent'),
      codexSessionsDir: join(root, 'also-absent')
    })
    expect(() => handlers.get(COST.list)!()).not.toThrow()
    expect(handlers.get(COST.list)!()).toEqual([])
  })
})

// The handler's real work: locate, read, parse, price, and map onto the wire
// shape. Previously the fixture tree was never wired in, so the handler could
// have returned [] unconditionally and the suite would have stayed green.
describe(`${COST.list} happy path`, () => {
  const list = (): ConversationCostInfo[] => handlers.get(COST.list)!() as ConversationCostInfo[]

  it('prices a real transcript and returns it', () => {
    setup([{ id: 'c1', tool: 'claude', agentSessionId: WITH_USAGE }])
    const [info] = list()
    expect(info.conversationId).toBe('c1')
    // 1M input on Opus 5 at $5/MTok.
    expect(info.mainCost).toBeCloseTo(5, 6)
    expect(info.mainTokens).toBe(1_000_000)
  })

  it('carries subagent spend SEPARATELY, not folded into the main figure', () => {
    setup([{ id: 'c1', tool: 'claude', agentSessionId: WITH_USAGE }])
    const [info] = list()
    // The sidechain ran haiku at $1/MTok; folding it in would have read as $6.
    expect(info.sidechainCost).toBeCloseTo(1, 6)
    expect(info.sidechainTokens).toBe(1_000_000)
  })

  it('lists the models and counts the messages', () => {
    setup([{ id: 'c1', tool: 'claude', agentSessionId: WITH_USAGE }])
    const [info] = list()
    expect(info.models.sort()).toEqual(['claude-haiku-4-5', 'claude-opus-5'])
    expect(info.messages).toBe(2)
  })

  it('returns the priced entry while omitting a zero-token one in the SAME call', () => {
    setup([
      { id: 'empty', tool: 'claude', agentSessionId: null },
      { id: 'real', tool: 'claude', agentSessionId: WITH_USAGE }
    ])
    expect(list().map((i) => i.conversationId)).toEqual(['real'])
  })

  it('reports a null cost with the unpriced model named, tokens intact', () => {
    setup([{ id: 'c1', tool: 'claude', agentSessionId: UNPRICED }])
    const [info] = list()
    expect(info.mainCost).toBeNull()
    expect(info.unpricedModels).toContain('brand-new-model')
    expect(info.mainTokens).toBe(2000)
  })

  it('honours a config rate override', () => {
    setup([{ id: 'c1', tool: 'claude', agentSessionId: SIDECHAIN }], {
      'claude-opus-5': { input: 1, output: 1000 }
    })
    // 200 output tokens at $1000/MTok.
    expect(list()[0].mainCost).toBeCloseTo(0.2, 6)
  })

  it('re-prices when the config rates change, rather than serving a stale cached figure', () => {
    setup([{ id: 'c1', tool: 'claude', agentSessionId: SIDECHAIN }])
    const first = list()[0].mainCost!
    handlers.clear()
    setup([{ id: 'c1', tool: 'claude', agentSessionId: SIDECHAIN }], {
      'claude-opus-5': { input: 1, output: 1000 }
    })
    expect(list()[0].mainCost).not.toBeCloseTo(first, 6)
  })

  it('returns the same answer on a repeated call (the cache does not corrupt it)', () => {
    setup([{ id: 'c1', tool: 'claude', agentSessionId: WITH_USAGE }])
    expect(list()).toEqual(list())
  })
})
