import { describe, expect, it } from 'vitest'
import { buildHeadlessLaunch } from './launch'
import { DEFAULT_YOLO_RECAP } from '../config/presets'
import { ConfigSchema, type Config } from '../config/schema'

function cfg(over: Record<string, unknown> = {}): Config {
  return ConfigSchema.parse({
    jira: { baseUrl: 'https://x.atlassian.net', email: 'a@b.co', apiToken: 't' },
    defaultTool: 'claude',
    cliTools: {
      claude: {
        command: 'claude',
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
  it('appends the default recap to the prompt', () => {
    const l = buildHeadlessLaunch(cfg(), {}, 'do it')
    expect(l.prompt).toBe(`do it\n\n${DEFAULT_YOLO_RECAP}`)
  })
  it('config yoloRecap overrides the default; empty string disables', () => {
    expect(buildHeadlessLaunch(cfg({ yoloRecap: 'custom recap' }), {}, 'p').prompt).toBe('p\n\ncustom recap')
    expect(buildHeadlessLaunch(cfg({ yoloRecap: '' }), {}, 'p').prompt).toBe('p')
  })
  it('throws for a tool without headless config', () => {
    expect(() => buildHeadlessLaunch(cfg(), { tool: 'bare' }, 'p')).toThrow(/no headless/i)
  })
  it('throws for an unknown tool', () => {
    expect(() => buildHeadlessLaunch(cfg(), { tool: 'nope' }, 'p')).toThrow(/Unknown CLI tool/)
  })
  it('canResume is false without resumeArgs', () => {
    const c = cfg()
    c.cliTools.claude.resumeArgs = undefined
    expect(buildHeadlessLaunch(c, {}, 'p').canResume).toBe(false)
  })
})
