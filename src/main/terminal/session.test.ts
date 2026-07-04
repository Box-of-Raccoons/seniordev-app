import { describe, it, expect } from 'vitest'
import { buildInteractiveLaunch } from './session'
import type { Config } from '../config/schema'
import type { ResolvedCommand } from './resolve-command'

const cfg = {
  defaultTool: 'claude',
  cliTools: {
    claude: { command: 'claude', interactiveArgs: [], promptDelivery: 'stdin' },
    codex: { command: 'codex', interactiveArgs: ['--foo'], promptDelivery: 'arg', promptArg: '{{prompt}}' }
  },
  repos: [{ key: 'PROJ', path: 'C:/code/backend', branchPrefix: '' }]
} as unknown as Config

const resumeCfg = {
  defaultTool: 'claude',
  cliTools: {
    claude: { command: 'claude', interactiveArgs: ['--ide'], resumeArgs: ['--resume', '{{sessionId}}'], promptDelivery: 'stdin' }
  },
  repos: []
} as unknown as Config

const noResumeArgsCfg = {
  defaultTool: 'claude',
  cliTools: {
    claude: { command: 'claude', interactiveArgs: [], promptDelivery: 'stdin' }
  },
  repos: []
} as unknown as Config

const modelCfg = {
  defaultTool: 'claude',
  cliTools: {
    claude: {
      command: 'claude',
      interactiveArgs: ['--ide'],
      promptDelivery: 'stdin',
      modelArgs: ['--model', '{{model}}'],
      defaultModel: 'claude-sonnet',
      resumeArgs: ['--resume', '{{sessionId}}']
    }
  },
  repos: []
} as unknown as Config

describe('buildInteractiveLaunch', () => {
  it('uses the default tool and interactiveArgs', () => {
    const l = buildInteractiveLaunch(cfg, {})
    expect(l.file).toBe('claude')
    expect(l.args).toEqual([])
  })
  it('uses an explicit tool and resolves cwd from the ticket', () => {
    const l = buildInteractiveLaunch(cfg, { tool: 'codex', ticketKey: 'PROJ-7' })
    expect(l.file).toBe('codex')
    expect(l.args).toEqual(['--foo'])
    expect(l.cwd).toBe('C:/code/backend')
  })
  it('throws on an unknown tool', () => {
    expect(() => buildInteractiveLaunch(cfg, { tool: 'nope' })).toThrow(/unknown cli tool/i)
  })
  it('appends an arg-delivery prompt to args', () => {
    const l = buildInteractiveLaunch(cfg, { tool: 'codex' }, 'DO THIS')
    expect(l.args).toEqual(['--foo', 'DO THIS'])
    expect(l.stdinPrompt).toBeUndefined()
  })
  it('sets stdinPrompt for a stdin-delivery tool', () => {
    const l = buildInteractiveLaunch(cfg, { tool: 'claude' }, 'DO THIS')
    expect(l.args).toEqual([])
    expect(l.stdinPrompt).toBe('DO THIS')
  })
  it('preserves $-sequences in an arg-delivery prompt (no regex-replace mangling)', () => {
    const l = buildInteractiveLaunch(cfg, { tool: 'codex' }, 'cost $$5 and $& more')
    expect(l.args).toEqual(['--foo', 'cost $$5 and $& more'])
  })
  it('appends expanded resumeArgs after interactiveArgs', () => {
    const launch = buildInteractiveLaunch(resumeCfg, { resume: { sessionId: 'abc-123' } })
    expect(launch.args).toEqual(['--ide', '--resume', 'abc-123'])
  })
  it('ignores resume when the tool has no resumeArgs', () => {
    const launch = buildInteractiveLaunch(noResumeArgsCfg, { resume: { sessionId: 'abc' } })
    expect(launch.args).toEqual([])
  })
  it('rejects a session id outside the UUID charset (shim cmd/c re-parse defense)', () => {
    expect(() => buildInteractiveLaunch(resumeCfg, { resume: { sessionId: 'a$&b' } })).toThrow(/Invalid session id/)
    expect(() => buildInteractiveLaunch(resumeCfg, { resume: { sessionId: 'x"&calc' } })).toThrow(/Invalid session id/)
  })

  it('downgrades arg-delivery to stdin when the command is a shell shim', () => {
    // codex resolves to codex.cmd (kind shell) → prompt must NOT ride the args
    // (they route through cmd /c and would be re-parsed / injectable).
    const shim: ResolvedCommand = { path: 'C:\\bin\\codex.cmd', kind: 'shell' }
    const l = buildInteractiveLaunch(cfg, { tool: 'codex' }, 'a & b\nc', () => shim)
    expect(l.args).toEqual(['--foo'])
    expect(l.args).not.toContain('a & b\nc')
    expect(l.stdinPrompt).toBe('a & b\nc')
    expect(l.resolved).toEqual(shim)
  })

  it('keeps arg-delivery in args when the command resolves to a real .exe', () => {
    const exe: ResolvedCommand = { path: 'C:\\bin\\codex.exe', kind: 'exe' }
    const l = buildInteractiveLaunch(cfg, { tool: 'codex' }, 'DO THIS', () => exe)
    expect(l.args).toEqual(['--foo', 'DO THIS'])
    expect(l.stdinPrompt).toBeUndefined()
    expect(l.resolved).toEqual(exe)
  })

  it('keeps current arg-delivery behavior when no resolver is provided', () => {
    const l = buildInteractiveLaunch(cfg, { tool: 'codex' }, 'DO THIS')
    expect(l.args).toEqual(['--foo', 'DO THIS'])
    expect(l.stdinPrompt).toBeUndefined()
    expect(l.resolved).toBeUndefined()
  })

  it('appends the prompt model after interactiveArgs', () => {
    const l = buildInteractiveLaunch(modelCfg, { model: 'claude-opus' })
    expect(l.args).toEqual(['--ide', '--model', 'claude-opus'])
  })
  it('falls back to the tool defaultModel when no prompt model is given', () => {
    const l = buildInteractiveLaunch(modelCfg, {})
    expect(l.args).toEqual(['--ide', '--model', 'claude-sonnet'])
  })
  it('does not re-assert a model flag when resuming', () => {
    const l = buildInteractiveLaunch(modelCfg, { resume: { sessionId: 'abc-123' } })
    expect(l.args).toEqual(['--ide', '--resume', 'abc-123'])
  })
  it('appends no model flag when the tool has neither modelArgs nor defaultModel (argv unchanged)', () => {
    const l = buildInteractiveLaunch(cfg, { tool: 'claude', model: 'ignored-no-modelArgs' })
    expect(l.args).toEqual([])
  })
})
