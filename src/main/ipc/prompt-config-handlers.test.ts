import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const handleMap = new Map<string, (...a: unknown[]) => unknown>()
const onMap = new Map<string, (...a: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (...a: unknown[]) => unknown) => handleMap.set(ch, fn),
    on: (ch: string, fn: (...a: unknown[]) => unknown) => onMap.set(ch, fn)
  }
}))

import { registerPromptConfigIpc } from './prompt-config-handlers'
import { ConfigStore } from '../config/store'
import { CONFIG, PROMPT_FILES, type PromptReadResult, type SaveResult } from '../../shared/ipc'

const MINIMAL = 'defaultTool: claude\n'

// Creates a real ConfigStore whose temp config sets promptsDir to a temp path,
// registers handlers, and returns a fake sender.
function setup() {
  const promptsDir = mkdtempSync(join(tmpdir(), 'sd-prompts-'))
  const cfgDir = mkdtempSync(join(tmpdir(), 'sd-cfg-'))
  const cfgPath = join(cfgDir, 'config.yaml')
  // Use forward slashes in the YAML value — Node.js fs accepts them on Windows.
  const promptsDirYaml = promptsDir.replace(/\\/g, '/')
  writeFileSync(cfgPath, `${MINIMAL}promptsDir: "${promptsDirYaml}"\n`, 'utf8')
  const store = new ConfigStore(cfgPath)
  store.reload()
  const sender = { send: vi.fn() }
  registerPromptConfigIpc(store, () => sender as unknown as Electron.WebContents)
  return { promptsDir, store, sender }
}

beforeEach(() => {
  handleMap.clear()
  onMap.clear()
})

describe('prompt-config handlers', () => {
  it('create → appears in store.prompts (in place) and broadcasts config:changed', async () => {
    const { store, sender } = setup()
    const promptsRef = store.prompts  // capture array reference before create

    const result = (await handleMap.get(PROMPT_FILES.create)!({}, 'fix-bug')) as PromptReadResult

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.text).toContain('name: fix-bug')
    // Same array instance — reloadPrompts() splices in place, never replaces the ref
    expect(store.prompts).toBe(promptsRef)
    expect(store.prompts.some((p) => p.name === 'fix-bug')).toBe(true)
    expect(sender.send).toHaveBeenCalledWith(CONFIG.changed)
  })

  it('write updates the file and refreshes prompts; bad frontmatter collision returns ok:false', async () => {
    const { store, sender } = setup()

    // Create 'one' and 'two'
    await handleMap.get(PROMPT_FILES.create)!({}, 'one')
    await handleMap.get(PROMPT_FILES.create)!({}, 'two')
    sender.send.mockClear()
    const namesBefore = store.prompts.map((p) => p.name).sort()

    // Write 'two' with frontmatter name: one → should collide
    const badText = '---\nname: one\ndescription: colliding\n---\nSome text\n'
    const result = (await handleMap.get(PROMPT_FILES.write)!({}, 'two', badText)) as SaveResult

    expect(result.ok).toBe(false)
    expect((result as { ok: false; error: string }).error).toMatch(/collides/i)
    // No broadcast on failure
    expect(sender.send).not.toHaveBeenCalled()
    // store.prompts content unchanged
    expect(store.prompts.map((p) => p.name).sort()).toEqual(namesBefore)
  })

  it('delete removes from disk and store.prompts', async () => {
    const { store, sender } = setup()

    await handleMap.get(PROMPT_FILES.create)!({}, 'to-delete')
    expect(store.prompts.some((p) => p.name === 'to-delete')).toBe(true)
    sender.send.mockClear()

    const result = (await handleMap.get(PROMPT_FILES.delete)!({}, 'to-delete')) as SaveResult

    expect(result.ok).toBe(true)
    expect(store.prompts).toHaveLength(0)
    expect(sender.send).toHaveBeenCalledWith(CONFIG.changed)
  })

  it('read of a missing prompt returns ok:false', async () => {
    setup()

    const result = (await handleMap.get(PROMPT_FILES.read)!({}, 'nope')) as PromptReadResult
    expect(result.ok).toBe(false)
  })
})
