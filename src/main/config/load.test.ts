import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadConfig, parseConfig } from './load'

function tmpConfig(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'sd-cfg-'))
  const p = join(dir, 'config.yaml')
  writeFileSync(p, yaml, 'utf8')
  return p
}

const MINIMAL = 'defaultTool: claude\n'

describe('parseConfig', () => {
  it('parses raw yaml text with presets merged', () => {
    const cfg = parseConfig(MINIMAL)
    expect(cfg.cliTools.claude.command).toBe('claude')
  })
  it('throws a Zod error naming the bad path', () => {
    // A cliTool with no command violates CliToolSchema.
    expect(() => parseConfig('cliTools:\n  bad: {}\n')).toThrow(/command/)
  })
  it('throws on YAML syntax errors', () => {
    expect(() => parseConfig('x: [unclosed')).toThrow()
  })
})

describe('loadConfig', () => {
  it('loads a minimal config and applies presets + defaults', () => {
    const cfg = loadConfig(tmpConfig(MINIMAL))
    expect(cfg.defaultTool).toBe('claude')
    expect(cfg.cliTools.claude.command).toBe('claude')
    expect(cfg.cliTools.codex.promptDelivery).toBe('arg')
    expect(cfg.forges.github.term).toBe('PR')
    expect(cfg.forges.gitlab.prCommand).toBe('glab mr create')
  })

  it('lets a user entry override a preset by key', () => {
    const cfg = loadConfig(
      tmpConfig(MINIMAL + '\ncliTools:\n  claude:\n    command: my-claude\n')
    )
    expect(cfg.cliTools.claude.command).toBe('my-claude')
    expect(cfg.cliTools.codex.command).toBe('codex')
  })

  it('preserves preset fields when a user overrides only one field', () => {
    // Overriding claude.command must NOT drop the preset's headless args (the
    // safety-relevant flags used by headless YOLO mode later).
    const cfg = loadConfig(
      tmpConfig(MINIMAL + '\ncliTools:\n  claude:\n    command: my-claude\n')
    )
    expect(cfg.cliTools.claude.command).toBe('my-claude')
    expect(cfg.cliTools.claude.headless?.outputParser).toBe('claude-stream-json')
  })

  it('throws on an invalid cliTool (missing command)', () => {
    expect(() => loadConfig(tmpConfig('cliTools:\n  bad: {}\n'))).toThrow(/command/)
  })
})
