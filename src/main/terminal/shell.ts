export interface ShellDef {
  command: string
  args: string[]
}

// Raw shells the composer's Terminal mode can open. These are real executables
// (not CLI-tool configs), spawned directly with a cwd and no seeded prompt — so
// none of the prompt-delivery readiness machinery applies.
export const BUILTIN_SHELLS: Record<string, ShellDef> = {
  powershell: { command: 'powershell.exe', args: ['-NoLogo'] },
  pwsh: { command: 'pwsh.exe', args: ['-NoLogo'] },
  cmd: { command: 'cmd.exe', args: [] },
  wsl: { command: 'wsl.exe', args: [] },
  bash: { command: 'bash', args: ['-l'] },
  zsh: { command: 'zsh', args: ['-l'] },
  sh: { command: 'sh', args: ['-l'] }
}

export function resolveShell(name: string): ShellDef {
  const def = BUILTIN_SHELLS[name]
  if (!def) throw new Error(`Unknown shell: ${name}`)
  return def
}

// The shells offered per OS, and the default selection. Platform-based (not a
// PATH probe) — an unavailable choice simply fails to spawn and reports it.
export function shellsForPlatform(platform: NodeJS.Platform = process.platform): string[] {
  return platform === 'win32' ? ['powershell', 'pwsh', 'cmd', 'wsl'] : ['bash', 'zsh', 'sh']
}

export function defaultShell(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'powershell' : 'bash'
}
