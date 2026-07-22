import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
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
    afterPack?: string
  }

  it('uses a per-user oneClick installer (never the crashing assisted installer)', () => {
    expect(cfg.nsis?.oneClick).toBe(true)
    expect(cfg.nsis?.perMachine).toBe(false)
  })

  // Regression guard for the macOS "damaged / malware" dialog: without a
  // Developer ID identity, electron-builder ships an unsigned .app that Apple
  // Silicon refuses to launch. The afterPack hook ad-hoc signs it so it runs
  // locally. If this wiring drifts, mac builds silently become unlaunchable.
  it('wires the afterPack hook that ad-hoc signs the macOS app', () => {
    expect(cfg.afterPack).toBe('build/adhoc-sign.cjs')
    expect(existsSync(resolve('build/adhoc-sign.cjs'))).toBe(true)
  })
})
