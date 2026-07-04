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
    const c = ConfigSchema.parse({ jira: { baseUrl: 'https://x.atlassian.net', email: 'a@b.co', apiToken: 't' }, yoloRecap: 'recap' })
    expect(c.yoloRecap).toBe('recap')
  })
  it('accepts yoloPreamble', () => {
    const c = ConfigSchema.parse({ jira: { baseUrl: 'https://x.atlassian.net', email: 'a@b.co', apiToken: 't' }, yoloPreamble: 'be autonomous' })
    expect(c.yoloPreamble).toBe('be autonomous')
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

describe('WatchSchema', () => {
  it('fills defaults when watch is absent (disabled)', () => {
    const cfg = ConfigSchema.parse({ jira: { baseUrl: 'https://x.atlassian.net', email: 'a@b.co', apiToken: 't' } })
    expect(cfg.watch).toEqual({
      enabled: false,
      intervalSeconds: 300,
      label: 'SeniorDev',
      triggerStatusCategory: 'To Do',
      transitionOnDispatch: 'In Progress',
      autoMode: false
    })
  })

  it('accepts overrides', () => {
    const cfg = ConfigSchema.parse({
      jira: { baseUrl: 'https://x.atlassian.net', email: 'a@b.co', apiToken: 't' },
      watch: { enabled: true, intervalSeconds: 60, autoMode: true }
    })
    expect(cfg.watch.enabled).toBe(true)
    expect(cfg.watch.intervalSeconds).toBe(60)
    expect(cfg.watch.autoMode).toBe(true)
    expect(cfg.watch.label).toBe('SeniorDev')
  })

  it('rejects a non-positive interval', () => {
    expect(() =>
      ConfigSchema.parse({ jira: { baseUrl: 'https://x.atlassian.net', email: 'a@b.co', apiToken: 't' }, watch: { intervalSeconds: 0 } })
    ).toThrow()
  })
})
