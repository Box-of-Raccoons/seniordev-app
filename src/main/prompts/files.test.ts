import { describe, expect, it, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CONTEXT_FILE, DEFAULT_TICKET_CONTEXT, ORCHESTRATOR_FILE,
  createPromptFile, deletePromptFile, readContextFile, readPromptFile, writeContextFile, writePromptFile,
  readOrchestratorFile, writeOrchestratorFile
} from './files'
import { DEFAULT_ORCHESTRATOR_PROMPT } from '../config/presets'
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
  it('context read falls back to the default; write round-trips', () => {
    expect(readContextFile(dir)).toBe(DEFAULT_TICKET_CONTEXT)
    writeContextFile(dir, 'custom {{ticket.key}}')
    expect(readContextFile(dir)).toBe('custom {{ticket.key}}')
    expect(existsSync(join(dir, CONTEXT_FILE))).toBe(true)
  })
  it('loadPrompts never lists _-prefixed files', () => {
    createPromptFile(dir, 'real')
    writeContextFile(dir, 'ctx')
    writeOrchestratorFile(dir, 'custom orchestrator')
    expect(loadPrompts(dir).map((p) => p.name)).toEqual(['real'])
  })
  it('orchestrator read falls back to the built-in preset when no override file', () => {
    expect(readOrchestratorFile(dir)).toBe(DEFAULT_ORCHESTRATOR_PROMPT)
    expect(existsSync(join(dir, ORCHESTRATOR_FILE))).toBe(false)
  })
  it('orchestrator override round-trips when present', () => {
    writeOrchestratorFile(dir, 'my router {{ticket.key}}')
    expect(existsSync(join(dir, ORCHESTRATOR_FILE))).toBe(true)
    expect(readOrchestratorFile(dir)).toBe('my router {{ticket.key}}')
  })
  it('writing the default text removes the override (reverts to built-in)', () => {
    writeOrchestratorFile(dir, 'my router')
    expect(existsSync(join(dir, ORCHESTRATOR_FILE))).toBe(true)
    writeOrchestratorFile(dir, DEFAULT_ORCHESTRATOR_PROMPT)
    expect(existsSync(join(dir, ORCHESTRATOR_FILE))).toBe(false)
    expect(readOrchestratorFile(dir)).toBe(DEFAULT_ORCHESTRATOR_PROMPT)
  })
})
