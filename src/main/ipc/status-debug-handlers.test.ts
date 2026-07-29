import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Capture the ipcMain.on handler the module registers.
const onMap = new Map<string, (...a: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: { on: (ch: string, fn: (...a: unknown[]) => unknown) => onMap.set(ch, fn) }
}))

import { registerStatusDebugIpc, formatScanEntry, STATUS_DEBUG_CHANNEL } from './status-debug-handlers'

beforeEach(() => onMap.clear())

describe('formatScanEntry', () => {
  it('wraps the id and text in scan delimiters', () => {
    const out = formatScanEntry('t1', 'Allow this action?', '2026-07-29T00:00:00Z')
    expect(out).toContain('===== SCAN id=t1 at 2026-07-29T00:00:00Z =====')
    expect(out).toContain('Allow this action?')
    expect(out).toContain('===== /SCAN =====')
  })
})

describe('registerStatusDebugIpc — the capture wiring', () => {
  it('writes the dumped buffer to the file on a debug-dump message', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sd-status-debug-'))
    const file = join(dir, 'status-scan-debug.txt')
    try {
      const returned = registerStatusDebugIpc(file)
      expect(returned).toBe(file)

      const handler = onMap.get(STATUS_DEBUG_CHANNEL)
      expect(handler).toBeTypeOf('function')

      handler!({}, 'tab-1', 'line one\n❯ 1. Yes\n  2. No')
      handler!({}, 'tab-1', 'a second capture')

      const contents = readFileSync(file, 'utf8')
      expect(contents).toContain('id=tab-1')
      expect(contents).toContain('❯ 1. Yes')
      expect(contents).toContain('a second capture')
      // Both entries appended, not overwritten.
      expect(contents.match(/===== SCAN /g)?.length).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      expect(existsSync(dir)).toBe(false)
    }
  })
})
