import { describe, expect, it } from 'vitest'
import { CliToolSchema, ConfigSchema } from './schema'

describe('headless config', () => {
  it('parses a headless block with defaults', () => {
    const t = CliToolSchema.parse({ command: 'x', headless: { args: ['-p'] } })
    expect(t.headless?.outputParser).toBe('text')
    expect(t.headless?.args).toEqual(['-p'])
  })
  it('rejects an unknown outputParser', () => {
    expect(() => CliToolSchema.parse({ command: 'x', headless: { outputParser: 'nope' } })).toThrow()
  })
  it('accepts resumeArgs and yoloRecap', () => {
    const t = CliToolSchema.parse({ command: 'x', resumeArgs: ['--resume', '{{sessionId}}'] })
    expect(t.resumeArgs).toEqual(['--resume', '{{sessionId}}'])
    const c = ConfigSchema.parse({ yoloRecap: 'recap' })
    expect(c.yoloRecap).toBe('recap')
  })
  it('accepts yoloPreamble', () => {
    const c = ConfigSchema.parse({ yoloPreamble: 'be autonomous' })
    expect(c.yoloPreamble).toBe('be autonomous')
  })
  it('parses a bracketedPaste flag on a tool', () => {
    const t = CliToolSchema.parse({ command: 'codex', bracketedPaste: true })
    expect(t.bracketedPaste).toBe(true)
    expect(CliToolSchema.parse({ command: 'claude' }).bracketedPaste).toBeUndefined()
  })
  it('still accepts configs carrying legacy yoloArgs', () => {
    const t = CliToolSchema.parse({ command: 'x', yoloArgs: ['--old'] })
    expect(t.command).toBe('x')
  })

  it('parses modelArgs and defaultModel, defaulting modelArgs to []', () => {
    const t = CliToolSchema.parse({ command: 'x', modelArgs: ['--model', '{{model}}'], defaultModel: 'big' })
    expect(t.modelArgs).toEqual(['--model', '{{model}}'])
    expect(t.defaultModel).toBe('big')
    const bare = CliToolSchema.parse({ command: 'x' })
    expect(bare.modelArgs).toEqual([])
    expect(bare.defaultModel).toBeUndefined()
  })
})

describe('ConfigSchema', () => {
  it('parses an empty config with preset-mergeable defaults', () => {
    const c = ConfigSchema.parse({})
    expect(c.defaultTool).toBe('claude')
    expect(c.repos).toEqual([])
  })
})
