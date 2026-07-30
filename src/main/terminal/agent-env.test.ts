import { describe, it, expect } from 'vitest'
import { sanitizeAgentEnv } from './agent-env'

describe('sanitizeAgentEnv', () => {
  it('drops CLAUDECODE and every CLAUDE_CODE_* marker (the nested-child signal)', () => {
    const out = sanitizeAgentEnv({
      CLAUDECODE: '1',
      CLAUDE_CODE_SESSION_ID: 'abc',
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      PATH: '/usr/bin'
    })
    expect(out.CLAUDECODE).toBeUndefined()
    expect(out.CLAUDE_CODE_SESSION_ID).toBeUndefined()
    expect(out.CLAUDE_CODE_CHILD_SESSION).toBeUndefined()
    expect(out.CLAUDE_CODE_ENTRYPOINT).toBeUndefined()
    expect(out.PATH).toBe('/usr/bin')
  })

  it('keeps ANTHROPIC_* auth and all unrelated vars intact', () => {
    const out = sanitizeAgentEnv({ ANTHROPIC_API_KEY: 'sk-x', HOME: '/home/h', TERM: 'xterm-256color' })
    expect(out).toEqual({ ANTHROPIC_API_KEY: 'sk-x', HOME: '/home/h', TERM: 'xterm-256color' })
  })

  it('does not scrub a similarly-named var that is not a child marker', () => {
    // CLAUDE_EFFORT is not the nested-session signal; only CLAUDECODE / CLAUDE_CODE_* are.
    const out = sanitizeAgentEnv({ CLAUDE_EFFORT: 'high', CLAUDE_CONFIG: 'x' })
    expect(out.CLAUDE_EFFORT).toBe('high')
    expect(out.CLAUDE_CONFIG).toBe('x')
  })

  it('skips keys with undefined values', () => {
    const out = sanitizeAgentEnv({ FOO: undefined, BAR: 'baz' })
    expect('FOO' in out).toBe(false)
    expect(out.BAR).toBe('baz')
  })
})
