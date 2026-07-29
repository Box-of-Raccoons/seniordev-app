// TEMPORARY — S1 step 4 capture aid. Dumps the exact rendered xterm buffer the
// scanner reads to a file, so the real approvalPatterns can be authored from what
// the scanner actually sees (plan section 5: patterns must come from captured
// text, not reasoning or docs). Triggered by Ctrl+Shift+Y in a focused terminal.
//
// REMOVE THIS FILE, its preload method (`debugDumpScan`), its index.ts
// registration, and the TerminalView chord once approvalPatterns are captured and
// the matcher's captured-text tests exist. It writes only a local debug file and
// never surfaces an error.

import { ipcMain } from 'electron'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultConfigDir } from '../config/paths'

export const STATUS_DEBUG_CHANNEL = 'status:debugDump'

// The one dumped entry, as it lands in the file. Pure, so the format is testable.
export function formatScanEntry(id: string, text: string, stamp: string): string {
  return `\n===== SCAN id=${id} at ${stamp} =====\n${text}\n===== /SCAN =====\n`
}

// Returns the file path so startup can log where captures land. `file` is
// injectable for tests; production uses the config dir.
export function registerStatusDebugIpc(file: string = join(defaultConfigDir(), 'status-scan-debug.txt')): string {
  ipcMain.on(STATUS_DEBUG_CHANNEL, (_e, id: string, text: string) => {
    try {
      appendFileSync(file, formatScanEntry(id, text, new Date().toISOString()))
    } catch {
      // Debug-only; a failed dump must never disturb the app.
    }
  })
  return file
}
