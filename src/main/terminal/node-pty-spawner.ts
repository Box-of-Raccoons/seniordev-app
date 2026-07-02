import { spawn as ptySpawn } from 'node-pty'
import type { PtySpawner, PtyProcess } from './manager'

// The ONLY module that imports the native node-pty. Never import this from a test.
export const nodePtySpawner: PtySpawner = ({ file, args, cwd, cols, rows }) => {
  const proc = ptySpawn(file, args, {
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
