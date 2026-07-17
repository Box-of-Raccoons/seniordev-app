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
    const store = new ConfigStore(join(tmpdir(), 'sd-none', 'nope.yaml'))
    const res = store.reload()
    expect(res.ok).toBe(false)
    expect(store.config).toBeNull()
    expect(store.loadError).toBeTruthy()
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
    const store = new ConfigStore(join(tmpdir(), 'sd-none', 'missing.yaml'))
    store.reload()
    expect(() => requireConfig(store)).toThrow(/Config not loaded/)
    const { store: good } = tmpSetup(MINIMAL)
    good.reload()
    expect(requireConfig(good)).not.toBeNull()
  })
})
