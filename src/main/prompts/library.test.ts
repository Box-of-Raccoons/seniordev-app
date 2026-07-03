import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadPrompts, findPrompt, parseFrontmatter } from './library'

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'sd-prompts-'))
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content, 'utf8')
  return dir
}

describe('loadPrompts', () => {
  it('returns [] for a missing directory', () => {
    expect(loadPrompts(join(tmpdir(), 'does-not-exist-xyz'))).toEqual([])
  })
  it('loads md prompts with frontmatter', () => {
    const dir = dirWith({
      'fix-bug.md': '---\nname: fix-bug\ndescription: Fix a bug\n---\nWork {{ticket.key}}.',
      'notes.txt': 'ignored'
    })
    const prompts = loadPrompts(dir)
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toEqual({ name: 'fix-bug', description: 'Fix a bug', body: 'Work {{ticket.key}}.' })
  })
  it('falls back to the filename when frontmatter has no name', () => {
    const dir = dirWith({ 'plain.md': 'just a body' })
    expect(loadPrompts(dir)[0]).toEqual({ name: 'plain', description: '', body: 'just a body' })
  })
})

describe('findPrompt', () => {
  it('finds by name or returns undefined', () => {
    const prompts = [{ name: 'a', description: '', body: 'x' }]
    expect(findPrompt(prompts, 'a')?.body).toBe('x')
    expect(findPrompt(prompts, 'z')).toBeUndefined()
  })
})

describe('parseFrontmatter', () => {
  it('is exported and parses frontmatter name/description/body', () => {
    const result = parseFrontmatter('---\nname: my-prompt\ndescription: A test\n---\nBody text', 'fallback')
    expect(result).toEqual({ name: 'my-prompt', description: 'A test', body: 'Body text' })
  })
  it('falls back to the given name when frontmatter has no name field', () => {
    const result = parseFrontmatter('just a body', 'fallback-name')
    expect(result).toEqual({ name: 'fallback-name', description: '', body: 'just a body' })
  })
})
