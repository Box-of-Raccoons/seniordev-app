import { describe, it, expect } from 'vitest'
import { resolveExpandedPrompt, type PromptDeps } from './resolve-prompt'
import type { Config } from '../config/schema'
import type { Ticket } from '../../shared/types'

const config = {
  ticketContext: 'both',
  defaultForge: 'github',
  forges: { github: { prCommand: 'gh pr create', term: 'PR', urlPattern: 'x' } },
  repos: []
} as unknown as Config

const ticket: Ticket = { key: 'PROJ-1', type: 'Bug', status: 'Open', summary: 's', descriptionAdf: null, acceptanceCriteria: null, comments: [], url: 'u' }

const deps: PromptDeps = {
  getTicket: async () => ticket,
  prompts: [
    { name: 'tech-lead', description: '', model: 'claude-opus', body: 'Design {{ticket.key}}' },
    { name: 'qa', description: '', body: 'Test it' },
    { name: 'cross', description: '', model: { claude: 'claude-opus-4-8', codex: 'gpt-5' }, body: 'Do {{ticket.key}}' }
  ]
}

describe('resolveExpandedPrompt', () => {
  it("carries a named prompt's frontmatter model alongside the expanded text", async () => {
    const r = await resolveExpandedPrompt(config, deps, { prompt: { name: 'tech-lead' }, ticketKey: 'PROJ-1' })
    expect(r?.model).toBe('claude-opus')
    expect(r?.prompt).toBe('Design PROJ-1')
  })

  it("carries a named prompt's per-tool model map through unresolved", async () => {
    const r = await resolveExpandedPrompt(config, deps, { prompt: { name: 'cross' }, ticketKey: 'PROJ-1' })
    expect(r?.model).toEqual({ claude: 'claude-opus-4-8', codex: 'gpt-5' })
    expect(r?.prompt).toBe('Do PROJ-1')
  })

  it('has no model for a named prompt that declares none', async () => {
    const r = await resolveExpandedPrompt(config, deps, { prompt: { name: 'qa' } })
    expect(r?.model).toBeUndefined()
    expect(r?.prompt).toBe('Test it')
  })

  it('has no model for ad-hoc prompt text', async () => {
    const r = await resolveExpandedPrompt(config, deps, { prompt: { text: 'ad-hoc work' } })
    expect(r?.model).toBeUndefined()
    expect(r?.prompt).toBe('ad-hoc work')
  })

  it('returns undefined when there is no prompt', async () => {
    expect(await resolveExpandedPrompt(config, deps, {})).toBeUndefined()
  })

  it('throws for an unknown named prompt', async () => {
    await expect(resolveExpandedPrompt(config, deps, { prompt: { name: 'ghost' } })).rejects.toThrow(/Unknown prompt/)
  })

  it('fills {{request}} from the raw input (works for free text with no ticket key)', async () => {
    const withReq: PromptDeps = { ...deps, prompts: [{ name: 'r', description: '', body: 'Task: {{request}}' }] }
    const r = await resolveExpandedPrompt(config, withReq, { prompt: { name: 'r' }, input: 'Document our CICD process' })
    expect(r?.prompt).toBe('Task: Document our CICD process')
  })

  it('leaves {{request}} empty when no input is given', async () => {
    const withReq: PromptDeps = { ...deps, prompts: [{ name: 'r', description: '', body: 'Task:[{{request}}]' }] }
    const r = await resolveExpandedPrompt(config, withReq, { prompt: { name: 'r' } })
    expect(r?.prompt).toBe('Task:[]')
  })

  it('is key-only: does not fetch the ticket, resolving even if getTicket would throw', async () => {
    const throwing: PromptDeps = {
      ...deps,
      getTicket: async () => {
        throw new Error('getTicket should not be called under key-only')
      }
    }
    const r = await resolveExpandedPrompt(config, throwing, { prompt: { name: 'tech-lead' }, ticketKey: 'PROJ-1' })
    expect(r?.prompt).toBe('Design PROJ-1')
  })
})
