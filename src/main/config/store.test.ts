import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigStore, requireConfig } from './store'

const MINIMAL = 'defaultTool: claude\n'

function tmpSetup(yaml: string): { store: ConfigStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sd-store-'))
  const cfgPath = join(dir, 'config.yaml')
  writeFileSync(cfgPath, yaml + `promptsDir: ${JSON.stringify(join(dir, 'prompts'))}\n`, 'utf8')
  return { store: new ConfigStore(cfgPath), dir }
}

describe('ConfigStore', () => {
  it('reload loads config', () => {
    const { store } = tmpSetup(MINIMAL)
    expect(store.reload()).toEqual({ ok: true })
    expect(store.config).not.toBeNull()
    expect(store.loadError).toBeNull()
  })

  it('reload failure keeps the last good config', () => {
    const { store } = tmpSetup(MINIMAL)
    store.reload()
    writeFileSync(store.configPath, 'cliTools: [broken', 'utf8')
    const res = store.reload()
    expect(res.ok).toBe(false)
    expect(store.config).not.toBeNull() // last-good preserved
    expect(store.loadError).toBeNull()  // loadError only set when NO good config exists
  })

  it('boot failure records loadError', () => {
    // A MALFORMED config is the real boot failure. (A MISSING file is not a
    // failure — it's the clean-install default; see the "missing config" cases in
    // load.test.ts and the clean-install boot test below.)
    const { store } = tmpSetup(MINIMAL)
    writeFileSync(store.configPath, 'cliTools: [broken', 'utf8')
    const store2 = new ConfigStore(store.configPath)
    const res = store2.reload()
    expect(res.ok).toBe(false)
    expect(store2.config).toBeNull()
    expect(store2.loadError).toBeTruthy()
  })

  it('a missing config file boots with defaults (clean install)', () => {
    // The bug this guards: a fresh install has no config.yaml; reload must succeed
    // with preset defaults, not fail — otherwise the boot gate skips prompt-seeding
    // and leaves config null, so tools/repos/prompts all come back empty.
    const dir = mkdtempSync(join(tmpdir(), 'sd-store-'))
    const store = new ConfigStore(join(dir, 'does-not-exist.yaml'))
    const res = store.reload()
    expect(res).toEqual({ ok: true })
    expect(store.config?.defaultTool).toBe('claude')
    expect(store.loadError).toBeNull()
  })

  it('reloadPrompts mutates the SAME array instance in place', () => {
    const { store, dir } = tmpSetup(MINIMAL)
    store.reload()
    const ref = store.prompts
    mkdirSync(join(dir, 'prompts'), { recursive: true })
    writeFileSync(join(dir, 'prompts', 'fix.md'), '---\nname: fix\ndescription: d\n---\nbody', 'utf8')
    store.reloadPrompts()
    expect(store.prompts).toBe(ref) // identity stable — handlers hold this reference
    expect(ref.map((p) => p.name)).toEqual(['fix'])
  })
})

describe('requireConfig', () => {
  it('throws with the load error when config is null', () => {
    // config stays null only on a real load failure (malformed file), not a
    // missing one — a missing file now boots with defaults.
    const dir = mkdtempSync(join(tmpdir(), 'sd-store-'))
    const cfgPath = join(dir, 'config.yaml')
    writeFileSync(cfgPath, 'cliTools: [broken', 'utf8')
    const store = new ConfigStore(cfgPath)
    store.reload()
    expect(() => requireConfig(store)).toThrow(/Config not loaded/)
    const { store: good } = tmpSetup(MINIMAL)
    good.reload()
    expect(requireConfig(good)).not.toBeNull()
  })
})
