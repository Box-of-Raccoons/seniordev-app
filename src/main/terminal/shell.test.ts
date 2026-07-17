import { describe, it, expect } from 'vitest'
import { resolveShell, shellsForPlatform, defaultShell } from './shell'

describe('resolveShell', () => {
  it('resolves a known shell to its command + args', () => {
    expect(resolveShell('powershell')).toEqual({ command: 'powershell.exe', args: ['-NoLogo'] })
    expect(resolveShell('bash')).toEqual({ command: 'bash', args: ['-l'] })
  })

  it('throws for an unknown shell', () => {
    expect(() => resolveShell('fish')).toThrow(/Unknown shell/)
  })
})

describe('shellsForPlatform', () => {
  it('offers Windows shells on win32', () => {
    expect(shellsForPlatform('win32')).toEqual(['powershell', 'pwsh', 'cmd', 'wsl'])
  })

  it('offers POSIX shells elsewhere', () => {
    expect(shellsForPlatform('linux')).toEqual(['bash', 'zsh', 'sh'])
    expect(shellsForPlatform('darwin')).toEqual(['bash', 'zsh', 'sh'])
  })

  it('every offered shell resolves', () => {
    for (const p of ['win32', 'linux', 'darwin'] as NodeJS.Platform[]) {
      for (const name of shellsForPlatform(p)) expect(() => resolveShell(name)).not.toThrow()
    }
  })
})

describe('defaultShell', () => {
  it('is powershell on Windows, bash elsewhere', () => {
    expect(defaultShell('win32')).toBe('powershell')
    expect(defaultShell('linux')).toBe('bash')
  })

  it('the default is always in the offered list', () => {
    for (const p of ['win32', 'linux', 'darwin'] as NodeJS.Platform[]) {
      expect(shellsForPlatform(p)).toContain(defaultShell(p))
    }
  })
})
