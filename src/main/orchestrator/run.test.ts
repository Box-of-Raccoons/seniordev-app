import { describe, it, expect, vi } from 'vitest'
import { finalize, buildClassifyLaunch, createClassifyRunner } from './run'
import { ConfigSchema } from '../config/schema'
import type { HeadlessChild } from '../headless/runner'
import type { PromptTemplate } from '../prompts/library'
import type { Ticket } from '../../shared/types'

const prompts: PromptTemplate[] = [{ name: 'fix-bug', description: 'fixes bugs', body: 'Work {{ticket.key}}' }]

describe('finalize', () => {
  it('non-zero exit → failure', () => {
    expect(finalize(1, '{"prompt":"fix-bug"}', prompts)).toEqual({ ok: false, reason: 'classifier exited with code 1' })
  })
  it('no JSON → failure', () => {
    expect(finalize(0, 'nope', prompts)).toEqual({ ok: false, reason: 'classifier returned no JSON verdict' })
  })
  it('null verdict carries the reason', () => {
    expect(finalize(0, '{"prompt":null,"reason":"no fit"}', prompts)).toEqual({ ok: false, reason: 'no fit' })
  })
  it('unknown name → failure', () => {
    expect(finalize(0, '{"prompt":"ghost"}', prompts)).toEqual({ ok: false, reason: 'classifier chose unknown playbook "ghost"' })
  })
  it('known name → ok', () => {
    expect(finalize(0, '{"prompt":"fix-bug"}', prompts)).toEqual({ ok: true, prompt: 'fix-bug' })
  })
})

const config = ConfigSchema.parse({
  jira: { baseUrl: 'https://x.atlassian.net', email: 'a@b.co', apiToken: 't' },
  cliTools: { claude: { command: 'claude', headless: { args: ['-p'], outputParser: 'text' } } },
  repos: [{ key: 'PROJ', path: 'C:/repos/proj' }]
})
const ticket: Ticket = { key: 'PROJ-1', type: 'Bug', status: 'Open', summary: 'boom', descriptionAdf: null, acceptanceCriteria: null, comments: [], url: 'u' }
const source = { config, loadError: null, prompts, getTicket: async () => ticket }

describe('buildClassifyLaunch', () => {
  it('builds a bare (no preamble/recap) launch carrying ticket + catalog', async () => {
    const launch = await buildClassifyLaunch(config, source, 'C:/nonexistent-prompts', { id: 'c1', ticketKey: 'PROJ-1' })
    expect(launch.file).toBe('claude')
    // bare:true → the classify prompt is NOT wrapped by the YOLO preamble.
    expect(launch.prompt).not.toContain('headless, autonomous session')
    expect(launch.prompt).toContain('boom')      // ticket summary
    expect(launch.prompt).toContain('fix-bug')   // catalog entry
  })
})

function fakeChild(): HeadlessChild & { stdout: (c: string) => void; exit: (n: number) => void } {
  const child = {
    stdout: (_: string) => {}, exit: (_: number) => {},
    onStdout(cb: (c: string) => void) { child.stdout = cb },
    onStderr() {},
    onExit(cb: (n: number) => void) { child.exit = cb },
    writeAndCloseStdin() {},
    kill() {}
  }
  return child
}

describe('createClassifyRunner', () => {
  it('streams via onLog and resolves through finalize', async () => {
    const child = fakeChild()
    const onLog = vi.fn()
    const engine = createClassifyRunner(() => child, onLog)
    const launch = await buildClassifyLaunch(config, source, 'C:/nope', { id: 'c1', ticketKey: 'PROJ-1' })
    const p = engine.run('c1', launch, prompts, [])
    child.stdout('{"prompt":"fix-bug"}\n')
    expect(onLog).toHaveBeenCalledWith('c1', '{"prompt":"fix-bug"}')
    child.exit(0)
    expect(await p).toEqual({ ok: true, prompt: 'fix-bug' })
  })
})
