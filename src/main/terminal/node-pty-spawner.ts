import { spawn as ptySpawn } from 'node-pty'
import type { PtySpawner, PtyProcess } from './manager'
import { resolveSpawnCommand } from './spawn-command'

// The ONLY module that imports the native node-pty. Never import this from a test.
export const nodePtySpawner: PtySpawner = ({ file, args, cwd, cols, rows }) => {
  const cmd = resolveSpawnCommand(process.platform, file, args, process.env.ComSpec)
  const proc = ptySpawn(cmd.file, cmd.args, {
    name: 'xterm-color',
    cwd,
    cols,
    rows,
    env: process.env as Record<string, string>
  })
  const wrapper: PtyProcess = {
    onData: (cb) => { proc.onData(cb) },
    onExit: (cb) => { proc.onExit(({ exitCode }) => cb({ exitCode })) },
    write: (data) => proc.write(data),
    resize: (c, r) => proc.resize(c, r),
    kill: () => proc.kill()
  }
  return wrapper
}
