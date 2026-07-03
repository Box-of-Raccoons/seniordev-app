import { describe, expect, it, vi, beforeEach } from 'vitest'

const handleMap = new Map<string, (...a: unknown[]) => unknown>()
const onMap = new Map<string, (...a: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (...a: unknown[]) => unknown) => handleMap.set(ch, fn),
    on: (ch: string, fn: (...a: unknown[]) => unknown) => onMap.set(ch, fn)
  }
}))

import { registerYoloIpc } from './yolo-handlers'
import { YOLO, type SpawnResult } from '../../shared/ipc'
import { ConfigSchema } from '../config/schema'
import { DEFAULT_YOLO_RECAP } from '../config/presets'
import type { HeadlessChild } from '../headless/runner'
import type { Ticket } from '../../shared/types'

// Fake headless child mirroring runner.test.ts — captures stdin and lets the
// test drive stdout/exit.
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

const ticket: Ticket = { key: 'PROJ-1', type: 'Bug', status: 'Open', summary: 's', descriptionAdf: null, acceptanceCriteria: null, comments: [], url: 'u' }
const deps = { getTicket: async () => ticket, prompts: [] }

const config = ConfigSchema.parse({
  jira: { baseUrl: 'https://x.atlassian.net', email: 'a@b.co', apiToken: 't' },
  defaultTool: 'claude',
  cliTools: {
    claude: {
      command: 'claude',
      headless: { args: ['-p'], outputParser: 'text', sessionIdPattern: 'sid=(\\S+)' },
      resumeArgs: ['--resume', '{{sessionId}}']
    }
  },
  forges: { github: { prCommand: 'gh pr create', term: 'PR', urlPattern: 'https://github\\.com/[^/\\s]+/[^/\\s]+/pull/\\d+' } },
  repos: [{ key: 'PROJ', path: 'C:/repos/proj' }]
})

beforeEach(() => { handleMap.clear(); onMap.clear() })

describe('yolo handlers', () => {
  it('start: expands prompt, spawns headless, streams log/pr, exit carries resume payload', async () => {
    const child = fakeChild()
    const send = vi.fn()
    registerYoloIpc(config, () => ({ send } as unknown as Electron.WebContents), () => child, deps)

    const res = (await handleMap.get(YOLO.start)!({}, { id: 'y1', ticketKey: 'PROJ-1', prompt: { text: 'work {{ticket.key}}' } })) as SpawnResult
    expect(res).toEqual({ ok: true })

    // The final stdin payload is the expanded prompt with the recap appended.
    expect(child.stdin[0].startsWith('work PROJ-1')).toBe(true)
    expect(child.stdin[0].endsWith(DEFAULT_YOLO_RECAP)).toBe(true)

    child.stdout('sid=abc\nhttps://github.com/a/b/pull/3\n')
    expect(send).toHaveBeenCalledWith(YOLO.log, { id: 'y1', text: 'sid=abc' })
    expect(send).toHaveBeenCalledWith(YOLO.pr, { id: 'y1', url: 'https://github.com/a/b/pull/3', term: 'PR' })

    child.exit(0)
    expect(send).toHaveBeenCalledWith(YOLO.exit, {
      id: 'y1',
      exitCode: 0,
      sessionId: 'abc',
      cwd: 'C:/repos/proj',
      tool: 'claude',
      canResume: true,
      prUrls: ['https://github.com/a/b/pull/3']
    })
  })

  it('start without a prompt returns ok:false', async () => {
    const child = fakeChild()
    registerYoloIpc(config, () => undefined, () => child, deps)
    const res = (await handleMap.get(YOLO.start)!({}, { id: 'y2' })) as SpawnResult
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/requires a prompt/) })
  })

  it('caps reflects whether the default tool has a headless block', () => {
    const child = fakeChild()
    registerYoloIpc(config, () => undefined, () => child, deps)
    expect(handleMap.get(YOLO.caps)!({})).toEqual({ available: true })
  })

  it('kill forwards to the runner', async () => {
    const child = fakeChild()
    registerYoloIpc(config, () => undefined, () => child, deps)
    await handleMap.get(YOLO.start)!({}, { id: 'y1', ticketKey: 'PROJ-1', prompt: { text: 'go' } })
    onMap.get(YOLO.kill)!({}, 'y1')
    expect(child.killed).toBe(true)
  })
})
