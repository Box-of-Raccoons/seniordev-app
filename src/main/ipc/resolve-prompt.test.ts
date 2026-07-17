import { describe, it, expect } from 'vitest'
import { resolveExpandedPrompt, type PromptDeps } from './resolve-prompt'
import type { Config } from '../config/schema'

const config = {
  defaultForge: 'github',
  forges: { github: { prCommand: 'gh pr create', term: 'PR', urlPattern: 'x' } },
  repos: []
} as unknown as Config

const deps: PromptDeps = {
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

  it('is key-only: injects only the ticket key, never fetched text', async () => {
    // tech-lead body is 'Design {{ticket.key}}'; the key comes straight from the
    // request, with no ticket fetch involved.
    const r = await resolveExpandedPrompt(config, deps, { prompt: { name: 'tech-lead' }, ticketKey: 'PROJ-1' })
    expect(r?.prompt).toBe('Design PROJ-1')
  })
})
