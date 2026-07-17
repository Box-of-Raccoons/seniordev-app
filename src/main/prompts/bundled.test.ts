import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { loadPrompts } from './library'

// Guards the shipped role library (resources/prompts) against the loader that
// actually reads it: every bundled role must parse with a name + description, and
// the curated set (default orchestrator + the rest) must be exactly what ships.
const prompts = loadPrompts(resolve('resources/prompts'))
const names = prompts.map((p) => p.name).sort()

describe('bundled role prompts', () => {
  it('every bundled prompt parses with a name, description, and body', () => {
    expect(prompts.length).toBeGreaterThan(0)
    for (const p of prompts) {
      expect(p.name, 'name').toBeTruthy()
      expect(p.description, `${p.name} description`).toBeTruthy()
      expect(p.body.trim().length, `${p.name} body`).toBeGreaterThan(0)
    }
  })

  it('ships the curated role set with orchestrator as a role', () => {
    expect(names).toEqual([
      'business-analyst',
      'doc-writer',
      'fix-bug',
      'orchestrator',
      'qa',
      'reviewer',
      'senior-dev',
      'tech-lead'
    ])
  })

  it('no longer ships the superseded developer / code-reviewer roles', () => {
    expect(names).not.toContain('developer')
    expect(names).not.toContain('code-reviewer')
  })

  it('every role body drives off {{request}} (key-only model)', () => {
    for (const p of prompts) expect(p.body, `${p.name} uses {{request}}`).toContain('{{request}}')
  })
})
