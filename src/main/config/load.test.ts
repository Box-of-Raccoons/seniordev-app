import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadConfig } from './load'

function tmpConfig(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'sd-cfg-'))
  const p = join(dir, 'config.yaml')
  writeFileSync(p, yaml, 'utf8')
  return p
}

const MINIMAL = `
jira:
  baseUrl: https://acme.atlassian.net
  email: dev@acme.com
  apiToken: secret-token
`

describe('loadConfig', () => {
  it('loads a minimal jira-only config and applies presets + defaults', () => {
    const cfg = loadConfig(tmpConfig(MINIMAL))
    expect(cfg.jira.baseUrl).toBe('https://acme.atlassian.net')
    expect(cfg.ticketContext).toBe('both')
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
    // Overriding claude.command must NOT drop the preset's yoloArgs (the
    // permission-mode flag used by YOLO mode later).
    const cfg = loadConfig(
      tmpConfig(MINIMAL + '\ncliTools:\n  claude:\n    command: my-claude\n')
    )
    expect(cfg.cliTools.claude.command).toBe('my-claude')
    expect(cfg.cliTools.claude.yoloArgs).toEqual(['--permission-mode', 'auto'])
  })

  it('throws on invalid jira email', () => {
    expect(() =>
      loadConfig(tmpConfig(`
jira:
  baseUrl: https://acme.atlassian.net
  email: not-an-email
  apiToken: x
`))
    ).toThrow()
  })
})
