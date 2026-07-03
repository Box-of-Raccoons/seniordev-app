import { describe, expect, it } from 'vitest'
import { nodeHeadlessSpawner } from './node-spawner'

// Real child process: echoes stdin to stdout, writes one stderr line, exits 7.
const SCRIPT =
  'let d="";process.stdin.on("data",(c)=>d+=c).on("end",()=>{process.stdout.write("got:"+d+"\\n");process.stderr.write("warn\\n");process.exit(7)})'

describe('nodeHeadlessSpawner (integration)', () => {
  it('round-trips stdin → stdout, surfaces stderr, reports the exit code', async () => {
    // resolved kind 'exe' mirrors production: systemResolveCommand always supplies
    // it on Windows, so the child spawns directly — never via cmd /c, which would
    // re-parse the quoted -e script.
    const child = nodeHeadlessSpawner({
      file: process.execPath,
      args: ['-e', SCRIPT],
      cwd: process.cwd(),
      resolved: { path: process.execPath, kind: 'exe' }
    })
    let out = ''
    let err = ''
    const exit = new Promise<number>((res) => child.onExit(res))
    child.onStdout((c) => (out += c))
    child.onStderr((c) => (err += c))
    child.writeAndCloseStdin('PING')
    expect(await exit).toBe(7)
    expect(out).toContain('got:PING')
    expect(err).toContain('warn')
  })
  it('reports a spawn failure as exit -1 instead of throwing', async () => {
    // kind 'exe' forces a direct spawn of a missing file → ENOENT 'error' event.
    // (Through cmd /c the shell itself spawns fine and exits nonzero instead.)
    const child = nodeHeadlessSpawner({
      file: 'definitely-not-a-real-binary-xyz.exe',
      args: [],
      cwd: process.cwd(),
      resolved: { path: 'definitely-not-a-real-binary-xyz.exe', kind: 'exe' }
    })
    const exit = new Promise<number>((res) => child.onExit(res))
    child.writeAndCloseStdin('x')
    expect(await exit).toBe(-1)
  })
})
