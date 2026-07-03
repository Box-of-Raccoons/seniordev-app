// node-pty spawns via CreateProcess on Windows, which only finds .exe on PATH —
// it cannot run a PATH shim like `claude.cmd`/`claude.bat` (the usual npm/global
// install shape), giving "Cannot create process, error code: 2". Route the spawn
// through the command shell so the command resolves exactly as it would when typed
// in a terminal (PATH + PATHEXT). No-op on POSIX, where node-pty resolves fine.
export function resolveSpawnCommand(
  platform: NodeJS.Platform,
  file: string,
  args: string[],
  comSpec: string = 'cmd.exe'
): { file: string; args: string[] } {
  if (platform === 'win32') {
    return { file: comSpec, args: ['/c', file, ...args] }
  }
  return { file, args }
}
