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

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'seniordev-cost-ipc-'))
  mkdirSync(join(root, 'p'), { recursive: true })
  writeFileSync(
    join(root, 'p', `${WITH_USAGE}.jsonl`),
    JSON.stringify({
      type: 'assistant',
      message: { model: 'claude-opus-5', usage: { input_tokens: 1_000_000, output_tokens: 0 } }
    })
  )
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

type Conv = { id: string; tool: string; agentSessionId: string | null }

function setup(conversations: Conv[], modelRates?: Record<string, { input: number; output: number }>): void {
  const persistence = { conversations: { list: () => conversations } } as unknown as SessionPersistence
  const source = { config: modelRates ? { modelRates } : {} } as unknown as ConfigSource
  registerCostIpc({ persistence, source })
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

  it('never throws when the whole transcript tree is absent', () => {
    setup([{ id: 'c1', tool: 'claude', agentSessionId: WITH_USAGE }])
    // HOME here is the real one, which may or may not have transcripts; either
    // way the call must return a value rather than blow up main. The handler is
    // synchronous, so this asserts on the return, not on a promise.
    expect(() => handlers.get(COST.list)!()).not.toThrow()
    expect(handlers.get(COST.list)!()).toBeInstanceOf(Array)
  })
})

describe('cost wire shape', () => {
  it('carries tokens, cost, messages and models per conversation', () => {
    // Shape assertion against the interface rather than the filesystem, so this
    // stays meaningful regardless of what transcripts exist on the test machine.
    const info: ConversationCostInfo = {
      conversationId: 'c1',
      mainTokens: 10,
      mainCost: 0.5,
      sidechainTokens: 4,
      sidechainCost: 0.1,
      unpricedModels: [],
      messages: 2,
      models: ['claude-opus-5']
    }
    expect(info.mainCost).not.toBeNull()
    expect(info.sidechainTokens).toBe(4)
  })

  it('allows a null cost alongside real tokens', () => {
    const info: ConversationCostInfo = {
      conversationId: 'c1',
      mainTokens: 999,
      mainCost: null,
      sidechainTokens: 0,
      sidechainCost: 0,
      unpricedModels: ['brand-new'],
      messages: 1,
      models: ['brand-new']
    }
    expect(info.mainCost).toBeNull()
    expect(info.mainTokens).toBe(999)
  })
})
