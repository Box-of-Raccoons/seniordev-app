import { describe, it, expect } from 'vitest'
import { buildInteractiveLaunch } from './session'
import type { Config } from '../config/schema'

const cfg = {
  defaultTool: 'claude',
  cliTools: {
    claude: { command: 'claude', interactiveArgs: [], yoloArgs: ['--permission-mode', 'bypassPermissions'], promptDelivery: 'stdin' },
    codex: { command: 'codex', interactiveArgs: ['--foo'], yoloArgs: ['--yolo'], promptDelivery: 'arg', promptArg: '{{prompt}}' }
  },
  repos: [{ key: 'PROJ', path: 'C:/code/backend', branchPrefix: '' }]
} as unknown as Config

describe('buildInteractiveLaunch', () => {
  it('uses the default tool and interactiveArgs (not yoloArgs)', () => {
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
})
