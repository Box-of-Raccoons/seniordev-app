import { describe, it, expect } from 'vitest'
import { gateCommandFor } from './gate-config'
import { ConfigSchema } from '../config/schema'
import type { Config } from '../config/schema'

const cfg = (over: Record<string, unknown> = {}): Config => ConfigSchema.parse(over)

describe('gateCommandFor', () => {
  it('is empty when nothing is configured, so no gate ever runs unasked', () => {
    expect(gateCommandFor(cfg(), '/repo')).toBe('')
  })

  it("uses a repo's own gate when the folder matches it", () => {
    const c = cfg({ repos: [{ key: 'APP', path: '/repo', gate: 'pnpm test' }] })
    expect(gateCommandFor(c, '/repo')).toBe('pnpm test')
  })

  it('falls back to defaultGate for a folder that is not a configured repo', () => {
    const c = cfg({ defaultGate: 'make check', repos: [{ key: 'APP', path: '/other', gate: 'pnpm test' }] })
    expect(gateCommandFor(c, '/elsewhere')).toBe('make check')
  })

  it("prefers the repo's gate over defaultGate", () => {
    const c = cfg({ defaultGate: 'make check', repos: [{ key: 'APP', path: '/repo', gate: 'pnpm test' }] })
    expect(gateCommandFor(c, '/repo')).toBe('pnpm test')
  })

  it('falls back to defaultGate when the matched repo declares no gate', () => {
    const c = cfg({ defaultGate: 'make check', repos: [{ key: 'APP', path: '/repo' }] })
    expect(gateCommandFor(c, '/repo')).toBe('make check')
  })

  it('matches a repo path regardless of separator or trailing slash', () => {
    const c = cfg({ repos: [{ key: 'APP', path: '/repo/', gate: 'pnpm test' }] })
    expect(gateCommandFor(c, '/repo')).toBe('pnpm test')
  })

  it('is empty for an empty folder rather than reaching for the default', () => {
    // No folder means no session to gate; running defaultGate somewhere
    // unspecified would execute a command in whatever cwd the app inherited.
    expect(gateCommandFor(cfg({ defaultGate: 'make check' }), '')).toBe('')
  })
})
