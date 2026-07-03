import { win32 } from 'node:path'
import { existsSync } from 'node:fs'

// Resolves a bare command (e.g. `claude`, `codex`) to a concrete file on disk the
// same way cmd.exe / where.exe would — walking PATH and appending PATHEXT — so the
// caller can tell a real .exe (spawnable directly by node-pty's CreateProcess) from
// a PATH shim like `claude.cmd`/`codex.bat` (which needs cmd.exe to run). Knowing the
// kind up front lets us keep arbitrary prompt text off any cmd.exe command line.
export type CommandKind = 'exe' | 'shell' | 'none'
export interface ResolvedCommand {
  path: string
  kind: CommandKind
}

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD'

function parsePathext(pathext: string): string[] {
  const source = pathext.trim() === '' ? DEFAULT_PATHEXT : pathext
  return source.split(';').filter((e) => e !== '')
}

function stripQuotes(s: string): string {
  return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s
}

function parsePath(pathStr: string): string[] {
  return pathStr.split(';').filter((e) => e !== '').map(stripQuotes)
}

// A matched path ending in .exe/.com can be spawned directly; anything else
// (.cmd/.bat/PATH shim) must ride through the command shell.
function classify(matched: string): CommandKind {
  const lower = matched.toLowerCase()
  return lower.endsWith('.exe') || lower.endsWith('.com') ? 'exe' : 'shell'
}

// Pure, fully injectable for tests — never touches process.env or the real fs.
export function resolveCommandPath(
  file: string,
  opts: { path: string; pathext: string; exists: (p: string) => boolean }
): ResolvedCommand {
  const exts = parsePathext(opts.pathext)
  const ext = win32.extname(file)
  const hasExt = ext !== ''

  // An explicit path (has a separator or a drive colon) is never PATH-searched.
  if (/[\\/]/.test(file) || file.includes(':')) {
    // file's own extension present and the file exists → take it verbatim (covers
    // both "ext in PATHEXT" and "some other ext but the file is really there").
    if (hasExt && opts.exists(file)) return { path: file, kind: classify(file) }
    for (const e of exts) {
      const candidate = file + e
      if (opts.exists(candidate)) return { path: candidate, kind: classify(candidate) }
    }
    return { path: file, kind: 'none' }
  }

  // Bare command: dirs outer, exts inner — PATH order outranks PATHEXT order across
  // dirs, mirroring where.exe. First hit wins.
  for (const dir of parsePath(opts.path)) {
    if (hasExt) {
      const asIs = win32.join(dir, file)
      if (opts.exists(asIs)) return { path: asIs, kind: classify(asIs) }
    }
    for (const e of exts) {
      const candidate = win32.join(dir, file + e)
      if (opts.exists(candidate)) return { path: candidate, kind: classify(candidate) }
    }
  }
  return { path: file, kind: 'none' }
}

// Convenience wiring used by src/main/index.ts. Resolution only matters on Windows
// (POSIX node-pty resolves PATH itself), so returns undefined elsewhere.
export function systemResolveCommand(file: string): ResolvedCommand | undefined {
  if (process.platform !== 'win32') return undefined
  return resolveCommandPath(file, {
    path: process.env.PATH ?? '',
    pathext: process.env.PATHEXT ?? '',
    exists: existsSync
  })
}
