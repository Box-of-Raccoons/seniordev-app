import { clipboard, ipcMain } from 'electron'
import { CLIPBOARD } from '../../shared/ipc'

// Text-only clipboard for the terminal. Reading via clipboard.readText() (never
// readImage) is deliberate: paste always carries text only, so image data on the
// OS clipboard can't reach Codex and trigger its "can't paste image" error.
export function registerClipboardIpc(): void {
  ipcMain.handle(CLIPBOARD.readText, (): string => clipboard.readText())
  ipcMain.on(CLIPBOARD.writeText, (_e, text: string): void => clipboard.writeText(text))
}
