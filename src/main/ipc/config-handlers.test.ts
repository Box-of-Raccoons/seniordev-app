import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
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

import { registerConfigIpc, STARTER_CONFIG, writeFileAtomic } from './config-handlers'
import { ConfigStore } from '../config/store'
import { CONFIG } from '../../shared/ipc'
import { DEFAULT_YOLO_PREAMBLE, DEFAULT_YOLO_RECAP } from '../config/presets'

const MINIMAL = 'jira:\n  baseUrl: https://x.atlassian.net\n  email: a@b.co\n  apiToken: t\n'

// Creates a temp dir, optionally pre-writes a config file, builds a real
// ConfigStore, reloads it when content is provided, then registers handlers
// and returns a captured fake sender.
function setup(initialContent?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'sd-config-'))
  const cfgPath = join(dir, 'config.yaml')
  if (initialContent !== undefined) writeFileSync(cfgPath, initialContent, 'utf8')
  const store = new ConfigStore(cfgPath)
  if (initialContent !== undefined) store.reload()
  const sender = { send: vi.fn() }
  registerConfigIpc(store, () => sender as unknown as Electron.WebContents)
  return { dir, cfgPath, store, sender }
}

beforeEach(() => {
  handleMap.clear()
  onMap.clear()
})

describe('config handlers', () => {
  it('read returns the raw file text and path', async () => {
    const { cfgPath } = setup(MINIMAL + '# a comment\n')
    const result = (await handleMap.get(CONFIG.read)!({})) as { ok: true; text: string; path: string; isTemplate?: boolean }
    expect(result.ok).toBe(true)
    expect(result.text).toContain('# a comment')
    expect(result.path).toBe(cfgPath)
    expect(result.isTemplate).toBeUndefined()
  })

  it('read returns STARTER_CONFIG with isTemplate when the file is missing', async () => {
    const { cfgPath } = setup() // no initial content → file absent
    const result = (await handleMap.get(CONFIG.read)!({})) as { ok: true; text: string; path: string; isTemplate?: boolean }
    expect(result.ok).toBe(true)
    expect(result.text).toBe(STARTER_CONFIG)
    expect(result.isTemplate).toBe(true)
    expect(result.path).toBe(cfgPath)
  })

  it('save validates first: invalid text writes nothing and returns the error', async () => {
    const { cfgPath, sender } = setup(MINIMAL)
    const result = (await handleMap.get(CONFIG.save)!({}, 'jira: [broken')) as { ok: boolean; error?: string }
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
    // File on disk is unchanged
    expect(readFileSync(cfgPath, 'utf8')).toBe(MINIMAL)
    // No broadcast
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('save writes, reloads the store, and broadcasts config:changed', async () => {
    const { cfgPath, store, sender } = setup()
    const newText = MINIMAL + 'defaultTool: codex\n'
    const result = (await handleMap.get(CONFIG.save)!({}, newText)) as { ok: boolean }
    expect(result.ok).toBe(true)
    expect(readFileSync(cfgPath, 'utf8')).toContain('defaultTool: codex')
    expect(store.config?.defaultTool).toBe('codex')
    expect(sender.send).toHaveBeenCalledWith(CONFIG.changed)
  })

  it('saveRecap refuses when no config file exists yet', async () => {
    const { sender } = setup() // file absent
    const result = (await handleMap.get(CONFIG.saveRecap)!({}, 'anything')) as { ok: boolean; error?: string }
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/save App Config first/i)
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('readRecap reports the built-in default until config overrides it', async () => {
    setup(MINIMAL) // load MINIMAL — no yoloRecap key
    const r1 = (await handleMap.get(CONFIG.readRecap)!({})) as { text: string; isDefault: boolean }
    expect(r1.text).toBe(DEFAULT_YOLO_RECAP)
    expect(r1.isDefault).toBe(true)

    // Save a config that now includes yoloRecap
    await handleMap.get(CONFIG.save)!({}, MINIMAL + 'yoloRecap: custom\n')
    const r2 = (await handleMap.get(CONFIG.readRecap)!({})) as { text: string; isDefault: boolean }
    expect(r2.text).toBe('custom')
    expect(r2.isDefault).toBe(false)
  })

  it('saveRecap edits ONLY the yoloRecap key and preserves comments elsewhere', async () => {
    const { cfgPath, store } = setup('# keep me\n' + MINIMAL)
    const result = (await handleMap.get(CONFIG.saveRecap)!({}, 'my recap')) as { ok: boolean }
    expect(result.ok).toBe(true)
    // Comment survived the round-trip
    expect(readFileSync(cfgPath, 'utf8')).toContain('# keep me')
    // Store was reloaded and reflects the new value
    expect(store.config?.yoloRecap).toBe('my recap')
  })

  it('saveRecap with the default text deletes the key', async () => {
    const { cfgPath } = setup(MINIMAL + 'yoloRecap: custom\n')
    const result = (await handleMap.get(CONFIG.saveRecap)!({}, DEFAULT_YOLO_RECAP)) as { ok: boolean }
    expect(result.ok).toBe(true)
    // yoloRecap key must be absent from the written file
    expect(readFileSync(cfgPath, 'utf8')).not.toContain('yoloRecap')
    // readRecap reports the built-in default again
    const r = (await handleMap.get(CONFIG.readRecap)!({})) as { isDefault: boolean }
    expect(r.isDefault).toBe(true)
  })

  it('savePreamble refuses when no config file exists yet', async () => {
    const { sender } = setup() // file absent
    const result = (await handleMap.get(CONFIG.savePreamble)!({}, 'anything')) as { ok: boolean; error?: string }
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/save App Config first/i)
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('readPreamble reports the built-in default until config overrides it', async () => {
    setup(MINIMAL) // load MINIMAL — no yoloPreamble key
    const r1 = (await handleMap.get(CONFIG.readPreamble)!({})) as { text: string; isDefault: boolean }
    expect(r1.text).toBe(DEFAULT_YOLO_PREAMBLE)
    expect(r1.isDefault).toBe(true)

    // Save a config that now includes yoloPreamble
    await handleMap.get(CONFIG.save)!({}, MINIMAL + 'yoloPreamble: custom\n')
    const r2 = (await handleMap.get(CONFIG.readPreamble)!({})) as { text: string; isDefault: boolean }
    expect(r2.text).toBe('custom')
    expect(r2.isDefault).toBe(false)
  })

  it('savePreamble edits ONLY the yoloPreamble key and preserves comments elsewhere', async () => {
    const { cfgPath, store } = setup('# keep me\n' + MINIMAL)
    const result = (await handleMap.get(CONFIG.savePreamble)!({}, 'my preamble')) as { ok: boolean }
    expect(result.ok).toBe(true)
    // Comment survived the round-trip
    expect(readFileSync(cfgPath, 'utf8')).toContain('# keep me')
    // Store was reloaded and reflects the new value
    expect(store.config?.yoloPreamble).toBe('my preamble')
  })

  it('savePreamble with the default text deletes the key', async () => {
    const { cfgPath } = setup(MINIMAL + 'yoloPreamble: custom\n')
    const result = (await handleMap.get(CONFIG.savePreamble)!({}, DEFAULT_YOLO_PREAMBLE)) as { ok: boolean }
    expect(result.ok).toBe(true)
    // yoloPreamble key must be absent from the written file
    expect(readFileSync(cfgPath, 'utf8')).not.toContain('yoloPreamble')
    // readPreamble reports the built-in default again
    const r = (await handleMap.get(CONFIG.readPreamble)!({})) as { isDefault: boolean }
    expect(r.isDefault).toBe(true)
  })

  it('writeFileAtomic creates parent dirs and leaves no .tmp behind', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sd-atomic-'))
    const p = join(dir, 'deep', 'file.txt')
    writeFileAtomic(p, 'x')
    expect(readFileSync(p, 'utf8')).toBe('x')
    expect(existsSync(p + '.tmp')).toBe(false)
  })
})
