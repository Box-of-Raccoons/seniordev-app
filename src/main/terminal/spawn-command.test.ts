import { describe, it, expect } from 'vitest'
import { resolveSpawnCommand } from './spawn-command'
import type { ResolvedCommand } from './resolve-command'

describe('resolveSpawnCommand', () => {
  it('spawns directly on non-Windows platforms', () => {
    expect(resolveSpawnCommand('linux', 'claude', ['--x'])).toEqual({ file: 'claude', args: ['--x'] })
    expect(resolveSpawnCommand('darwin', 'claude', [])).toEqual({ file: 'claude', args: [] })
  })

  it('spawns a resolved .exe directly on win32 (no cmd.exe) with untouched args', () => {
    const resolved: ResolvedCommand = { path: 'C:\\bin\\codex.exe', kind: 'exe' }
    // Metacharacters in args stay inert because they never reach a shell.
    const out = resolveSpawnCommand('win32', 'codex', ['--prompt', 'a & b | c'], 'cmd.exe', resolved)
    expect(out).toEqual({ file: 'C:\\bin\\codex.exe', args: ['--prompt', 'a & b | c'] })
  })

  it('routes a shell-kind command through cmd.exe /c on win32', () => {
    const resolved: ResolvedCommand = { path: 'C:\\bin\\claude.cmd', kind: 'shell' }
    expect(resolveSpawnCommand('win32', 'claude', ['--permission-mode', 'bypassPermissions'], 'cmd.exe', resolved)).toEqual({
      file: 'cmd.exe',
      args: ['/c', 'claude', '--permission-mode', 'bypassPermissions']
    })
  })

  it('routes through cmd.exe /c on win32 when the command is unresolved', () => {
    const out = resolveSpawnCommand('win32', 'codex', ['--yolo'], 'C:/Windows/System32/cmd.exe')
    expect(out.file).toBe('C:/Windows/System32/cmd.exe')
    expect(out.args).toEqual(['/c', 'codex', '--yolo'])
  })
})
