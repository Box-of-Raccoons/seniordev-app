import { ipcMain } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseDocument } from 'yaml'
import { CONFIG, type ConfigReadResult, type PreambleInfo, type RecapInfo, type SaveResult } from '../../shared/ipc'
import { parseConfig } from '../config/load'
import { DEFAULT_YOLO_PREAMBLE, DEFAULT_YOLO_RECAP } from '../config/presets'
import type { ConfigStore } from '../config/store'

// Shown when no config.yaml exists yet — mirrors config.example.yaml, but lives
// in code so the packaged app doesn't need to locate the example on disk.
export const STARTER_CONFIG = `# SeniorDev config
jira:
  baseUrl: https://yoursite.atlassian.net
  email: you@company.com
  apiToken: paste-token-from-id.atlassian.net

# Everything below is optional; presets for claude/codex + github/gitlab apply automatically.
# ticketContext: both        # key-only | both
# defaultTool: claude
# defaultForge: github
# repos:
#   - key: PROJ
#     path: C:/Users/you/code/backend
#     branchPrefix: feature/
#     forge: github
`

export function writeFileAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, path)
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function registerConfigIpc(
  store: ConfigStore,
  getSender: () => Electron.WebContents | undefined
): void {
  // Validate → write → reload → broadcast. Shared by save and saveRecap so a
  // bad edit can never reach disk and a good one always goes live.
  function commit(text: string): SaveResult {
    parseConfig(text) // throws with YAML line numbers or Zod paths
    writeFileAtomic(store.configPath, text)
    const res = store.reload()
    // Near-unreachable (reload re-parses what we just validated): disk already
    // holds the new VALID text, so a reload failure here is soft — the store
    // keeps last-good and the next read/save self-heals. No broadcast.
    if (!res.ok) return res
    getSender()?.send(CONFIG.changed)
    return { ok: true }
  }

  ipcMain.handle(CONFIG.read, (): ConfigReadResult => {
    try {
      if (!existsSync(store.configPath)) {
        return { ok: true, text: STARTER_CONFIG, path: store.configPath, isTemplate: true }
      }
      return { ok: true, text: readFileSync(store.configPath, 'utf8'), path: store.configPath }
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  })

  ipcMain.handle(CONFIG.save, (_e, text: string): SaveResult => {
    try {
      return commit(text)
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  })

  ipcMain.handle(CONFIG.readRecap, (): RecapInfo => {
    const v = store.config?.yoloRecap
    return { text: v ?? DEFAULT_YOLO_RECAP, isDefault: v === undefined }
  })

  ipcMain.handle(CONFIG.saveRecap, (_e, text: string): SaveResult => {
    try {
      if (!existsSync(store.configPath)) {
        return { ok: false, error: 'No config file yet — save App Config first' }
      }
      // Targeted document edit: only the yoloRecap key changes; comments and
      // formatting everywhere else survive byte-for-byte.
      const doc = parseDocument(readFileSync(store.configPath, 'utf8'))
      if (text.trim() === DEFAULT_YOLO_RECAP.trim()) doc.delete('yoloRecap')
      else doc.set('yoloRecap', text)
      return commit(doc.toString())
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  })

  ipcMain.handle(CONFIG.readPreamble, (): PreambleInfo => {
    const v = store.config?.yoloPreamble
    return { text: v ?? DEFAULT_YOLO_PREAMBLE, isDefault: v === undefined }
  })

  ipcMain.handle(CONFIG.savePreamble, (_e, text: string): SaveResult => {
    try {
      if (!existsSync(store.configPath)) {
        return { ok: false, error: 'No config file yet — save App Config first' }
      }
      // Targeted document edit: only the yoloPreamble key changes; comments and
      // formatting everywhere else survive byte-for-byte.
      const doc = parseDocument(readFileSync(store.configPath, 'utf8'))
      if (text.trim() === DEFAULT_YOLO_PREAMBLE.trim()) doc.delete('yoloPreamble')
      else doc.set('yoloPreamble', text)
      return commit(doc.toString())
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  })
}
