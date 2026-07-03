import { ipcMain } from 'electron'
import { CONFIG, PROMPT_FILES, type PromptReadResult, type SaveResult } from '../../shared/ipc'
import type { ConfigStore } from '../config/store'
import {
  createPromptFile, deletePromptFile, readContextFile, readPromptFile, writeContextFile, writePromptFile
} from '../prompts/files'

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function registerPromptConfigIpc(
  store: ConfigStore,
  getSender: () => Electron.WebContents | undefined
): void {
  // Any successful prompt write refreshes the live array (same instance the
  // terminal/yolo handlers hold) and tells open renderer UI to refetch.
  function changed(): void {
    store.reloadPrompts()
    getSender()?.send(CONFIG.changed)
  }

  ipcMain.handle(PROMPT_FILES.read, (_e, name: string): PromptReadResult => {
    try { return { ok: true, text: readPromptFile(store.promptsDir(), name) } }
    catch (err) { return { ok: false, error: errMsg(err) } }
  })

  ipcMain.handle(PROMPT_FILES.write, (_e, name: string, text: string): SaveResult => {
    try { writePromptFile(store.promptsDir(), name, text); changed(); return { ok: true } }
    catch (err) { return { ok: false, error: errMsg(err) } }
  })

  ipcMain.handle(PROMPT_FILES.create, (_e, name: string): PromptReadResult => {
    try { const text = createPromptFile(store.promptsDir(), name); changed(); return { ok: true, text } }
    catch (err) { return { ok: false, error: errMsg(err) } }
  })

  ipcMain.handle(PROMPT_FILES.delete, (_e, name: string): SaveResult => {
    try { deletePromptFile(store.promptsDir(), name); changed(); return { ok: true } }
    catch (err) { return { ok: false, error: errMsg(err) } }
  })

  ipcMain.handle(PROMPT_FILES.readContext, (): PromptReadResult => {
    try { return { ok: true, text: readContextFile(store.promptsDir()) } }
    catch (err) { return { ok: false, error: errMsg(err) } }
  })

  ipcMain.handle(PROMPT_FILES.writeContext, (_e, text: string): SaveResult => {
    try { writeContextFile(store.promptsDir(), text); changed(); return { ok: true } }
    catch (err) { return { ok: false, error: errMsg(err) } }
  })
}
