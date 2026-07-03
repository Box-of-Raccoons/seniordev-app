import { describe, expect, it, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CONTEXT_FILE, DEFAULT_TICKET_CONTEXT,
  createPromptFile, deletePromptFile, readContextFile, readPromptFile, writeContextFile, writePromptFile
} from './files'
import { loadPrompts } from './library'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'sd-prompts-')) })

describe('prompt files', () => {
  it('create writes a skeleton with frontmatter and returns it', () => {
    const text = createPromptFile(dir, 'fix-bug')
    expect(text).toContain('name: fix-bug')
    expect(readFileSync(join(dir, 'fix-bug.md'), 'utf8')).toBe(text)
  })
  it('create refuses an existing name', () => {
    createPromptFile(dir, 'fix-bug')
    expect(() => createPromptFile(dir, 'fix-bug')).toThrow(/already exists/)
  })
  it('rejects unsafe names (path separators, leading underscore/dot)', () => {
    for (const bad of ['../evil', 'a/b', '_reserved', '.hidden', ''])
      expect(() => createPromptFile(dir, bad)).toThrow(/Invalid prompt name/)
  })
  it('write validates frontmatter parses and effective-name collisions with OTHER files', () => {
    createPromptFile(dir, 'one')
    createPromptFile(dir, 'two')
    // renaming 'two' (via frontmatter) to collide with 'one' must throw:
    expect(() => writePromptFile(dir, 'two', '---\nname: one\ndescription: d\n---\nbody')).toThrow(/collides/)
    // same-file rename to a fresh name is fine:
    writePromptFile(dir, 'two', '---\nname: two-renamed\ndescription: d\n---\nbody')
    expect(readPromptFile(dir, 'two')).toContain('two-renamed')
  })
  it('delete removes the file', () => {
    createPromptFile(dir, 'gone')
    deletePromptFile(dir, 'gone')
    expect(existsSync(join(dir, 'gone.md'))).toBe(false)
  })
  it('context read falls back to the default; write round-trips', () => {
    expect(readContextFile(dir)).toBe(DEFAULT_TICKET_CONTEXT)
    writeContextFile(dir, 'custom {{ticket.key}}')
    expect(readContextFile(dir)).toBe('custom {{ticket.key}}')
    expect(existsSync(join(dir, CONTEXT_FILE))).toBe(true)
  })
  it('loadPrompts never lists _-prefixed files', () => {
    createPromptFile(dir, 'real')
    writeContextFile(dir, 'ctx')
    expect(loadPrompts(dir).map((p) => p.name)).toEqual(['real'])
  })
})
