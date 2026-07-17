import { describe, expect, it, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPromptFile, deletePromptFile, readPromptFile, writePromptFile } from './files'
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
  it('self-skip is case-insensitive: writing fix-bug over Fix-Bug.md is not a collision', () => {
    createPromptFile(dir, 'Fix-Bug')
    // Same file on a case-insensitive filesystem — must NOT be treated as a rival.
    writePromptFile(dir, 'fix-bug', '---\nname: Fix-Bug\ndescription: d\n---\nupdated')
    expect(readPromptFile(dir, 'Fix-Bug')).toContain('updated')
  })
  it('write into a not-yet-existing prompts dir succeeds (dir is created)', () => {
    const fresh = join(dir, 'nested', 'prompts')
    writePromptFile(fresh, 'first', '---\nname: first\ndescription: d\n---\nbody')
    expect(readPromptFile(fresh, 'first')).toContain('body')
  })
  it('read and delete also enforce the name guard', () => {
    expect(() => readPromptFile(dir, '../evil')).toThrow(/Invalid prompt name/)
    expect(() => deletePromptFile(dir, '_reserved')).toThrow(/Invalid prompt name/)
  })
  it('loadPrompts never lists _-prefixed files', () => {
    createPromptFile(dir, 'real')
    writeFileSync(join(dir, '_special.md'), '---\nname: special\n---\nx', 'utf8')
    expect(loadPrompts(dir).map((p) => p.name)).toEqual(['real'])
  })
})
