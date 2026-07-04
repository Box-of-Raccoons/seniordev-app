import { describe, expect, it } from 'vitest'
import { buildHeadlessLaunch } from './launch'
import { DEFAULT_YOLO_PREAMBLE, DEFAULT_YOLO_RECAP } from '../config/presets'
import { ConfigSchema, type Config } from '../config/schema'

function cfg(over: Record<string, unknown> = {}): Config {
  return ConfigSchema.parse({
    jira: { baseUrl: 'https://x.atlassian.net', email: 'a@b.co', apiToken: 't' },
    defaultTool: 'claude',
    cliTools: {
      claude: {
        command: 'claude',
        modelArgs: ['--model', '{{model}}'],
        headless: { args: ['-p', '--output-format', 'stream-json'], outputParser: 'claude-stream-json' },
        resumeArgs: ['--resume', '{{sessionId}}']
      },
      bare: { command: 'bare' }
    },
    repos: [{ key: 'PROJ', path: 'C:/repos/proj' }],
    ...over
  })
}

describe('buildHeadlessLaunch', () => {
  it('builds file/args/cwd from tool + ticket mapping', () => {
    const l = buildHeadlessLaunch(cfg(), { ticketKey: 'PROJ-1' }, 'do it')
    expect(l.file).toBe('claude')
    expect(l.args).toEqual(['-p', '--output-format', 'stream-json'])
    expect(l.cwd).toBe('C:/repos/proj')
    expect(l.outputParser).toBe('claude-stream-json')
    expect(l.canResume).toBe(true)
  })
  it('prepends the default preamble and appends the default recap, in order', () => {
    const l = buildHeadlessLaunch(cfg(), {}, 'do it')
    expect(l.prompt).toBe(`${DEFAULT_YOLO_PREAMBLE}\n\ndo it\n\n${DEFAULT_YOLO_RECAP}`)
  })
  it('config yoloRecap overrides the default; empty string disables (no trailing separator)', () => {
    expect(buildHeadlessLaunch(cfg({ yoloPreamble: '', yoloRecap: 'custom recap' }), {}, 'p').prompt).toBe('p\n\ncustom recap')
    expect(buildHeadlessLaunch(cfg({ yoloPreamble: '', yoloRecap: '' }), {}, 'p').prompt).toBe('p')
  })
  it('config yoloPreamble overrides the default; empty string disables (no leading separator)', () => {
    expect(buildHeadlessLaunch(cfg({ yoloPreamble: 'custom pre', yoloRecap: '' }), {}, 'p').prompt).toBe('custom pre\n\np')
    expect(buildHeadlessLaunch(cfg({ yoloPreamble: '', yoloRecap: '' }), {}, 'p').prompt).toBe('p')
  })
  it('throws for a tool without headless config', () => {
    expect(() => buildHeadlessLaunch(cfg(), { tool: 'bare' }, 'p')).toThrow(/no headless/i)
  })
  it('throws for an unknown tool', () => {
    expect(() => buildHeadlessLaunch(cfg(), { tool: 'nope' }, 'p')).toThrow(/Unknown CLI tool/)
  })
  it('bare:true uses exactly the expanded prompt — no preamble or recap', () => {
    expect(buildHeadlessLaunch(cfg(), { bare: true }, 'do it').prompt).toBe('do it')
  })
  it('bare:false (default) keeps the preamble + prompt + recap wrapping', () => {
    expect(buildHeadlessLaunch(cfg(), { bare: false }, 'do it').prompt).toBe(`${DEFAULT_YOLO_PREAMBLE}\n\ndo it\n\n${DEFAULT_YOLO_RECAP}`)
  })
  it('canResume is false without resumeArgs', () => {
    const c = cfg()
    c.cliTools.claude.resumeArgs = undefined
    expect(buildHeadlessLaunch(c, {}, 'p').canResume).toBe(false)
  })
  it('appends the prompt model to the headless args', () => {
    const l = buildHeadlessLaunch(cfg(), { model: 'claude-opus' }, 'p')
    expect(l.args).toEqual(['-p', '--output-format', 'stream-json', '--model', 'claude-opus'])
  })
  it('uses the tool defaultModel when the prompt has no model', () => {
    const c = cfg()
    c.cliTools.claude.defaultModel = 'claude-sonnet'
    expect(buildHeadlessLaunch(c, {}, 'p').args).toEqual(['-p', '--output-format', 'stream-json', '--model', 'claude-sonnet'])
  })
  it('the prompt model overrides the tool defaultModel', () => {
    const c = cfg()
    c.cliTools.claude.defaultModel = 'claude-sonnet'
    expect(buildHeadlessLaunch(c, { model: 'claude-opus' }, 'p').args).toEqual(['-p', '--output-format', 'stream-json', '--model', 'claude-opus'])
  })
  it('appends no model flag when neither a prompt model nor a defaultModel is set (argv unchanged)', () => {
    expect(buildHeadlessLaunch(cfg(), {}, 'p').args).toEqual(['-p', '--output-format', 'stream-json'])
  })
})
