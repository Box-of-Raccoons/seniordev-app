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
})
