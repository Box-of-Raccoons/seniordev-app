import { spawn as ptySpawn } from 'node-pty'
import type { PtySpawner, PtyProcess } from './manager'
import { resolveSpawnCommand } from './spawn-command'
import { sanitizeAgentEnv } from './agent-env'

// The ONLY module that imports the native node-pty. Never import this from a test.
export const nodePtySpawner: PtySpawner = ({ file, args, cwd, cols, rows, resolved }) => {
  const cmd = resolveSpawnCommand(process.platform, file, args, process.env.ComSpec, resolved)
  const proc = ptySpawn(cmd.file, cmd.args, {
    name: 'xterm-color',
    cwd,
    cols,
    rows,
    // Scrub CLAUDECODE / CLAUDE_CODE_* so a spawned claude is a normal top-level
    // session, not a non-persisting nested child, no matter how SeniorDev itself
    // was launched (see agent-env.ts).
    env: sanitizeAgentEnv(process.env)
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
