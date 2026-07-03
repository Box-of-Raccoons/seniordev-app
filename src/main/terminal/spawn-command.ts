import type { ResolvedCommand } from './resolve-command'

// node-pty spawns via CreateProcess on Windows, which only finds .exe on PATH — it
// cannot run a PATH shim like `claude.cmd`/`claude.bat` (the usual npm/global install
// shape), giving "Cannot create process, error code: 2". So on Windows there are
// three cases, driven by a pre-resolved command (see resolve-command.ts):
//   - kind 'exe'  → spawn the resolved .exe/.com directly; args are passed
//                   structurally, so shell metacharacters in them are inert.
//   - otherwise   → route through the command shell (`cmd /c <file> <args>`) so the
//     (shell/none/  shim resolves as it would when typed. cmd.exe RE-PARSES this line,
//      undefined)   so callers MUST NOT let untrusted text (ticket/prompt content)
//                   reach these args — session.ts downgrades 'arg' delivery to stdin
//                   whenever the command is a shell shim for exactly this reason.
// No-op on POSIX, where node-pty resolves PATH fine.
export function resolveSpawnCommand(
  platform: NodeJS.Platform,
  file: string,
  args: string[],
  comSpec: string = 'cmd.exe',
  resolved?: ResolvedCommand
): { file: string; args: string[] } {
  if (platform === 'win32') {
    if (resolved?.kind === 'exe') {
      return { file: resolved.path, args }
    }
    return { file: comSpec, args: ['/c', file, ...args] }
  }
  return { file, args }
}
