import { describe, expect, it, vi } from 'vitest'
import { YoloRunner, type HeadlessChild } from './runner'
import { TextParser } from './parsers/text'

function fakeChild(): HeadlessChild & {
  stdout: (chunk: string) => void
  exit: (code: number) => void
  stdin: string[]
  killed: boolean
} {
  const child = {
    stdin: [] as string[],
    killed: false,
    stdout: (_: string) => {},
    stderrCb: (_: string) => {},
    exit: (_: number) => {},
    onStdout(cb: (c: string) => void) { child.stdout = cb },
    onStderr(cb: (c: string) => void) { child.stderrCb = cb },
    onExit(cb: (code: number) => void) { child.exit = cb },
    writeAndCloseStdin(data: string) { child.stdin.push(data) },
    kill() { child.killed = true }
  }
  return child
}

const GH = [{ term: 'PR', regex: new RegExp('https://github\\.com/[^/\\s]+/[^/\\s]+/pull/\\d+') }]

describe('YoloRunner', () => {
  it('delivers the prompt to stdin, streams logs, captures session + PRs, reports exit', () => {
    const child = fakeChild()
    const cb = { onLog: vi.fn(), onPr: vi.fn(), onExit: vi.fn() }
    const runner = new YoloRunner(() => child, cb)
    runner.start('y1', {
      file: 'x', args: [], cwd: '.', prompt: 'PROMPT',
      parser: new TextParser('session id: (\\S+)'), patterns: GH
    })
    expect(child.stdin).toEqual(['PROMPT'])
    child.stdout('session id: abc\nopened https://github.com/a/b/pull/9\n')
    expect(cb.onLog).toHaveBeenCalledWith('y1', 'session id: abc')
    expect(cb.onPr).toHaveBeenCalledWith('y1', 'https://github.com/a/b/pull/9', 'PR')
    child.exit(0)
    expect(cb.onExit).toHaveBeenCalledWith('y1', { exitCode: 0, sessionId: 'abc', prUrls: ['https://github.com/a/b/pull/9'] })
    expect(runner.has('y1')).toBe(false)
  })
  it('flushes the parser tail on exit', () => {
    const child = fakeChild()
    const cb = { onLog: vi.fn(), onPr: vi.fn(), onExit: vi.fn() }
    new YoloRunner(() => child, cb).start('y1', {
      file: 'x', args: [], cwd: '.', prompt: 'p', parser: new TextParser(), patterns: []
    })
    child.stdout('no newline yet')
    child.exit(0)
    expect(cb.onLog).toHaveBeenCalledWith('y1', 'no newline yet')
  })
  it('rejects a duplicate id and kill() kills the child', () => {
    const child = fakeChild()
    const cb = { onLog: vi.fn(), onPr: vi.fn(), onExit: vi.fn() }
    const runner = new YoloRunner(() => child, cb)
    runner.start('y1', { file: 'x', args: [], cwd: '.', prompt: 'p', parser: new TextParser(), patterns: [] })
    expect(() => runner.start('y1', { file: 'x', args: [], cwd: '.', prompt: 'p', parser: new TextParser(), patterns: [] })).toThrow(/already/)
    runner.kill('y1')
    expect(child.killed).toBe(true)
    expect(runner.has('y1')).toBe(false)
  })
  it('a killed child\'s late exit does not evict a new run reusing the id', () => {
    const first = fakeChild()
    const second = fakeChild()
    let call = 0
    const cb = { onLog: vi.fn(), onPr: vi.fn(), onExit: vi.fn() }
    const runner = new YoloRunner(() => (++call === 1 ? first : second), cb)
    runner.start('y1', { file: 'x', args: [], cwd: '.', prompt: 'p', parser: new TextParser(), patterns: [] })
    runner.kill('y1')
    runner.start('y1', { file: 'x', args: [], cwd: '.', prompt: 'p', parser: new TextParser(), patterns: [] })
    first.exit(1) // taskkill'd child reports its close late
    expect(runner.has('y1')).toBe(true) // the new child must survive in the map
    expect(cb.onExit).toHaveBeenCalledWith('y1', { exitCode: 1, sessionId: undefined, prUrls: [] })
  })
})
