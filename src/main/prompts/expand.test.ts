import { describe, it, expect } from 'vitest'
import { buildPromptTicket, expandPrompt, resolveForge } from './expand'
import type { Ticket } from '../../shared/types'
import type { Config } from '../config/schema'

const ticket: Ticket = {
  key: 'PROJ-1', type: 'Bug', status: 'Open', summary: 'Login broken',
  descriptionAdf: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'It fails.' }] }] },
  acceptanceCriteria: null,
  comments: [{ author: 'Jane', createdIso: '', bodyAdf: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'seen it' }] }] } }],
  url: 'https://x/browse/PROJ-1'
}

describe('buildPromptTicket', () => {
  it('fills markdown fields in both mode', () => {
    const pt = buildPromptTicket(ticket, 'both')
    expect(pt.key).toBe('PROJ-1')
    expect(pt.summary).toBe('Login broken')
    expect(pt.descriptionMd).toBe('It fails.')
    expect(pt.commentsMd).toContain('**Jane**')
    expect(pt.acceptanceCriteria).toBe('')
  })
  it('fills only the key in key-only mode', () => {
    const pt = buildPromptTicket(ticket, 'key-only')
    expect(pt.key).toBe('PROJ-1')
    expect(pt.summary).toBe('')
    expect(pt.descriptionMd).toBe('')
    expect(pt.commentsMd).toBe('')
  })
})

describe('resolveForge', () => {
  const cfg = {
    defaultForge: 'github',
    forges: {
      github: { prCommand: 'gh pr create', term: 'PR', urlPattern: 'x' },
      gitlab: { prCommand: 'glab mr create', term: 'MR', urlPattern: 'y' }
    },
    repos: [{ key: 'PROJ', path: '/p', branchPrefix: '', forge: 'gitlab' }]
  } as unknown as Config
  it('uses the mapped repo forge', () => {
    expect(resolveForge(cfg, 'PROJ-2').term).toBe('MR')
  })
  it('falls back to defaultForge', () => {
    expect(resolveForge(cfg, 'OTHER-1').prCommand).toBe('gh pr create')
    expect(resolveForge(cfg).prCommand).toBe('gh pr create')
  })
})

describe('expandPrompt', () => {
  const pt = buildPromptTicket(ticket, 'both')
  const forge = { prCommand: 'gh pr create', term: 'PR' }
  it('substitutes ticket and forge placeholders', () => {
    const out = expandPrompt('Do {{ticket.key}}: "{{ticket.summary}}". Open a {{forge.term}} with `{{forge.prCommand}}`.', { ticket: pt, forge })
    expect(out).toBe('Do PROJ-1: "Login broken". Open a PR with `gh pr create`.')
  })
  it('leaves unknown placeholders untouched', () => {
    expect(expandPrompt('keep {{weird.thing}}', { ticket: pt, forge })).toBe('keep {{weird.thing}}')
  })
  it('expands {{ticket.context}} from the context template (one level)', () => {
    const out = expandPrompt('Do it.\n\n{{ticket.context}}', {
      ticket: { ...pt, key: 'P-1', summary: 'S' },
      forge: { prCommand: 'gh pr create', term: 'PR' },
      contextTemplate: 'Ticket {{ticket.key}}: {{ticket.summary}}'
    })
    expect(out).toBe('Do it.\n\nTicket P-1: S')
  })
  it('a {{ticket.context}} inside the template itself stays literal (no loop)', () => {
    const out = expandPrompt('{{ticket.context}}', {
      ticket: { ...pt, key: 'P-1' },
      forge: { prCommand: '', term: 'PR' },
      contextTemplate: 'K={{ticket.key}} SELF={{ticket.context}}'
    })
    expect(out).toBe('K=P-1 SELF={{ticket.context}}')
  })
  it('without a contextTemplate, {{ticket.context}} stays literal', () => {
    const out = expandPrompt('{{ticket.context}}', { ticket: pt, forge: { prCommand: '', term: 'PR' } })
    expect(out).toBe('{{ticket.context}}')
  })
  it('substitutes {{prompts.catalog}} when a catalog is supplied', () => {
    const out = expandPrompt('Pick:\n{{prompts.catalog}}', { ticket: pt, forge, catalog: '- fix-bug: fixes bugs' })
    expect(out).toBe('Pick:\n- fix-bug: fixes bugs')
  })
  it('without a catalog, {{prompts.catalog}} stays literal', () => {
    expect(expandPrompt('{{prompts.catalog}}', { ticket: pt, forge })).toBe('{{prompts.catalog}}')
  })
})
