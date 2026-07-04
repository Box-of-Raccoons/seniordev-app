import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { seedDefaultPrompts } from './defaults'
import { parseFrontmatter, loadPrompts } from './library'
import { buildPromptTicket, expandPrompt } from './expand'
import { DEFAULT_TICKET_CONTEXT } from './files'
import type { Ticket } from '../../shared/types'

// The committed prompt library that ships with the app.
const SHIPPED_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../resources/prompts')

// Template keys expand.ts actually substitutes — anything else renders literally
// to the model, so a prompt must never use it. Keep in sync with expand.ts.
const ALLOWED_KEYS = new Set([
  'ticket.key', 'ticket.type', 'ticket.status', 'ticket.summary', 'ticket.description',
  'ticket.acceptanceCriteria', 'ticket.comments', 'forge.term', 'forge.prCommand', 'ticket.context'
])
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/

let target: string
beforeEach(() => { target = mkdtempSync(join(tmpdir(), 'sd-seed-')) })

describe('seedDefaultPrompts', () => {
  it('copies every shipped prompt into an empty target and returns their names', () => {
    const seeded = seedDefaultPrompts(SHIPPED_DIR, target)
    expect(seeded.sort()).toEqual(
      ['business-analyst', 'code-reviewer', 'developer', 'doc-writer', 'qa', 'tech-lead']
    )
    expect(loadPrompts(target).map((p) => p.name).sort()).toEqual(seeded.sort())
  })

  it('never overwrites a prompt the user already has', () => {
    writeFileSync(join(target, 'developer.md'), 'MINE', 'utf8')
    const seeded = seedDefaultPrompts(SHIPPED_DIR, target)
    expect(seeded).not.toContain('developer')
    expect(readFileSync(join(target, 'developer.md'), 'utf8')).toBe('MINE')
  })

  it('is idempotent — a second run seeds nothing', () => {
    seedDefaultPrompts(SHIPPED_DIR, target)
    expect(seedDefaultPrompts(SHIPPED_DIR, target)).toEqual([])
  })

  it('ignores non-.md files and _-prefixed specials in the source', () => {
    const src = mkdtempSync(join(tmpdir(), 'sd-src-'))
    writeFileSync(join(src, 'real.md'), '---\nname: real\ndescription: d\n---\nbody', 'utf8')
    writeFileSync(join(src, '_ticket-context.md'), 'ctx', 'utf8')
    writeFileSync(join(src, 'notes.txt'), 'nope', 'utf8')
    expect(seedDefaultPrompts(src, target)).toEqual(['real'])
    expect(existsSync(join(target, '_ticket-context.md'))).toBe(false)
    expect(existsSync(join(target, 'notes.txt'))).toBe(false)
  })

  it('returns [] when the source dir is missing', () => {
    expect(seedDefaultPrompts(join(target, 'does-not-exist'), target)).toEqual([])
  })
})

describe('shipped prompt library is valid (acceptance criteria)', () => {
  const files = readdirSync(SHIPPED_DIR).filter((f) => f.toLowerCase().endsWith('.md') && !f.startsWith('_'))
  const parsed = files.map((f) => parseFrontmatter(readFileSync(join(SHIPPED_DIR, f), 'utf8'), f.replace(/\.md$/i, '')))

  it('ships the expected role set', () => {
    expect(files.sort()).toEqual(
      ['business-analyst.md', 'code-reviewer.md', 'developer.md', 'doc-writer.md', 'qa.md', 'tech-lead.md']
    )
  })

  it('every prompt has a kebab-case name and a non-empty description and body', () => {
    for (const p of parsed) {
      expect(p.name, `name of ${p.name}`).toMatch(KEBAB)
      expect(p.description.trim(), `description of ${p.name}`).not.toBe('')
      expect(p.body.trim(), `body of ${p.name}`).not.toBe('')
    }
  })

  it('names are unique', () => {
    const names = parsed.map((p) => p.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('uses only supported template variables', () => {
    for (const p of parsed) {
      for (const m of p.body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
        expect(ALLOWED_KEYS.has(m[1]), `${p.name} uses unsupported {{${m[1]}}}`).toBe(true)
      }
    }
  })

  it('dev / qa / doc prompts instruct feature-branch + PR and forbid main/develop', () => {
    for (const name of ['developer', 'qa', 'doc-writer']) {
      const body = parsed.find((p) => p.name === name)!.body
      expect(body, name).toMatch(/feature branch|feature\/|test\/|docs\//i)
      expect(body, name).toContain('{{forge.prCommand}}')
      expect(body, name).toMatch(/main.*develop|develop.*main/)
    }
  })

  it('dev / qa / doc prompts drive Jira status: In Progress on start, In Review on PR, Blocked when stuck', () => {
    for (const name of ['developer', 'qa', 'doc-writer']) {
      const body = parsed.find((p) => p.name === name)!.body
      // Mechanism: resolve the transition by name, then apply it (mirrors JiraClient.transition).
      expect(body, name).toContain('getTransitionsForJiraIssue')
      expect(body, name).toContain('transitionJiraIssue')
      // The three workflow states the ticket requires.
      expect(body, name).toContain('In Progress')
      expect(body, name).toContain('In Review')
      expect(body, name).toContain('Blocked')
    }
  })
})

describe('shipped prompt expands end to end', () => {
  const ticket: Ticket = {
    key: 'SD-4', type: 'Story', status: 'To Do', summary: 'Add role-based prompt templates',
    descriptionAdf: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A doc.' }] }] },
    acceptanceCriteria: 'Each prompt is a valid .md file.',
    comments: [{ author: 'Hardy', createdIso: '', bodyAdf: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'do it' }] }] } }],
    url: 'https://x/browse/SD-4'
  }

  it('developer.md fully resolves with no leftover placeholders', () => {
    const body = parseFrontmatter(readFileSync(join(SHIPPED_DIR, 'developer.md'), 'utf8'), 'developer').body
    const out = expandPrompt(body, {
      ticket: buildPromptTicket(ticket, 'both'),
      forge: { prCommand: 'gh pr create', term: 'PR' },
      contextTemplate: DEFAULT_TICKET_CONTEXT
    })
    expect(out).toContain('SD-4')
    expect(out).toContain('gh pr create')
    expect(out).not.toContain('{{')
  })
})
