import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'

// Regression guard for the installer crash: the assisted NSIS installer
// (oneClick:false) dies with an access violation (0xC0000005) in NSIS's bundled
// System.dll at the elevation / mode-selection step. The fix — and the only
// config that produces a working installer on this stack — is a per-user
// oneClick install. This test fails loudly if the config ever drifts back.
describe('electron-builder NSIS config', () => {
  // vitest runs from the repo root, matching the resolve('resources/...') pattern
  // the other tests use.
  const cfg = parse(readFileSync(resolve('electron-builder.yml'), 'utf8')) as {
    nsis?: { oneClick?: boolean; perMachine?: boolean }
  }

  it('uses a per-user oneClick installer (never the crashing assisted installer)', () => {
    expect(cfg.nsis?.oneClick).toBe(true)
    expect(cfg.nsis?.perMachine).toBe(false)
  })
})
