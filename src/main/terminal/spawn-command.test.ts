import { describe, it, expect } from 'vitest'
import { resolveSpawnCommand } from './spawn-command'

describe('resolveSpawnCommand', () => {
  it('routes through cmd.exe /c on win32 so PATH shims (claude.cmd) resolve', () => {
    expect(resolveSpawnCommand('win32', 'claude', ['--permission-mode', 'bypassPermissions'])).toEqual({
      file: 'cmd.exe',
      args: ['/c', 'claude', '--permission-mode', 'bypassPermissions']
    })
  })

  it('honors an explicit ComSpec on win32', () => {
    const out = resolveSpawnCommand('win32', 'codex', ['--yolo'], 'C:/Windows/System32/cmd.exe')
    expect(out.file).toBe('C:/Windows/System32/cmd.exe')
    expect(out.args).toEqual(['/c', 'codex', '--yolo'])
  })

  it('spawns directly on non-Windows platforms', () => {
    expect(resolveSpawnCommand('linux', 'claude', ['--x'])).toEqual({ file: 'claude', args: ['--x'] })
    expect(resolveSpawnCommand('darwin', 'claude', [])).toEqual({ file: 'claude', args: [] })
  })
})
