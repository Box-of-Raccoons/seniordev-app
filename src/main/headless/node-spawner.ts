import { spawn, spawnSync } from 'node:child_process'
import { resolveSpawnCommand } from '../terminal/spawn-command'
import type { HeadlessSpawner } from './runner'

// Real child_process-backed spawner. Reuses resolveSpawnCommand so a PATH shim
// (claude.cmd / codex.cmd) rides through `cmd /c` on Windows — safe here because
// headless args are fixed config values; the prompt goes over stdin only.
export const nodeHeadlessSpawner: HeadlessSpawner = (opts) => {
  const { file, args } = resolveSpawnCommand(
    process.platform,
    opts.file,
    opts.args,
    process.env.ComSpec ?? 'cmd.exe',
    opts.resolved
  )
  const child = spawn(file, args, { cwd: opts.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  let exited = false
  let exitCb: (code: number) => void = () => {}
  const fireExit = (code: number): void => {
    if (!exited) {
      exited = true
      exitCb(code)
    }
  }
  child.on('error', () => fireExit(-1)) // spawn failure (ENOENT) or kill error
  child.on('close', (code) => fireExit(code ?? -1))
  return {
    onStdout: (cb) => void child.stdout.on('data', cb),
    onStderr: (cb) => void child.stderr.on('data', cb),
    onExit: (cb) => {
      exitCb = cb
    },
    writeAndCloseStdin: (data) => {
      // Swallow EPIPE from an already-dead child; exit reporting covers it.
      child.stdin.on('error', () => {})
      child.stdin.write(data, () => child.stdin.end())
    },
    kill: () => {
      if (process.platform === 'win32' && child.pid) {
        // child.kill() only kills the direct child; the CLI's own children
        // (git/gh/test runners) would survive and keep mutating the repo.
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'])
      } else {
        child.kill('SIGTERM')
      }
    }
  }
}
