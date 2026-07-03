import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const handleMap = new Map<string, (...a: unknown[]) => unknown>()
const onMap = new Map<string, (...a: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (...a: unknown[]) => unknown) => handleMap.set(ch, fn),
    on: (ch: string, fn: (...a: unknown[]) => unknown) => onMap.set(ch, fn)
  }
}))

import { registerOrchestratorIpc } from './orchestrator-handlers'
import { ORCHESTRATOR, YOLO, CONFIG, type ClassifyResult, type OrchestratorPromptInfo, type SaveResult } from '../../shared/ipc'
import { ConfigSchema } from '../config/schema'
import { DEFAULT_ORCHESTRATOR_PROMPT } from '../config/presets'
import { ORCHESTRATOR_FILE as ORCH_FILE } from '../prompts/files'
import type { HeadlessChild } from '../headless/runner'
import type { Ticket } from '../../shared/types'

// Fake headless child mirroring yolo-handlers.test.ts — the test drives
// stdout/exit; kill() only flags, so a test simulates the child's exit itself.
function fakeChild(): HeadlessChild & { stdout: (chunk: string) => void; exit: (code: number) => void; killed: boolean } {
  const child = {
    killed: false,
    stdout: (_: string) => {},
    stderrCb: (_: string) => {},
    exit: (_: number) => {},
    onStdout(cb: (c: string) => void) { child.stdout = cb },
    onStderr(cb: (c: string) => void) { child.stderrCb = cb },
    onExit(cb: (code: number) => void) { child.exit = cb },
    writeAndCloseStdin(_data: string) {},
    kill() { child.killed = true }
  }
  return child
}

// Flush microtasks so the async classify handler reaches runner.start (it awaits
// getTicket) before the test drives the child's stdout/exit.
const flush = (): Promise<void> => new Promise((r) => setImmediate(r))

const ticket: Ticket = { key: 'PROJ-1', type: 'Bug', status: 'Open', summary: 's', descriptionAdf: null, acceptanceCriteria: null, comments: [], url: 'u' }

const config = ConfigSchema.parse({
  jira: { baseUrl: 'https://x.atlassian.net', email: 'a@b.co', apiToken: 't' },
  defaultTool: 'claude',
  cliTools: {
    claude: { command: 'claude', headless: { args: ['-p'], outputParser: 'text' }, resumeArgs: ['--resume', '{{sessionId}}'] }
  },
  forges: { github: { prCommand: 'gh pr create', term: 'PR', urlPattern: 'https://github\\.com/[^/\\s]+/[^/\\s]+/pull/\\d+' } },
  repos: [{ key: 'PROJ', path: 'C:/repos/proj' }]
})

function makeSource() {
  return { config, loadError: null, prompts: [{ name: 'fix-bug', description: 'fixes bugs', body: 'b' }], getTicket: async () => ticket }
}

let dir: string
beforeEach(() => { handleMap.clear(); onMap.clear(); dir = mkdtempSync(join(tmpdir(), 'sd-orch-')) })

describe('orchestrator handlers — classify', () => {
  it('known playbook verdict → ok:true and streams the log on the YOLO channel', async () => {
    const child = fakeChild()
    const send = vi.fn()
    registerOrchestratorIpc(() => ({ send } as unknown as Electron.WebContents), () => child, { source: makeSource(), promptsDir: () => dir })
    const p = handleMap.get(ORCHESTRATOR.classify)!({}, { id: 'c1', ticketKey: 'PROJ-1' }) as Promise<ClassifyResult>
    await flush()
    child.stdout('{"prompt": "fix-bug"}\n')
    expect(send).toHaveBeenCalledWith(YOLO.log, { id: 'c1', text: '{"prompt": "fix-bug"}' })
    child.exit(0)
    expect(await p).toEqual({ ok: true, prompt: 'fix-bug' })
  })

  it('unknown playbook name → ok:false with reason', async () => {
    const child = fakeChild()
    registerOrchestratorIpc(() => undefined, () => child, { source: makeSource(), promptsDir: () => dir })
    const p = handleMap.get(ORCHESTRATOR.classify)!({}, { id: 'c1', ticketKey: 'PROJ-1' }) as Promise<ClassifyResult>
    await flush()
    child.stdout('{"prompt": "nope"}\n')
    child.exit(0)
    expect(await p).toEqual({ ok: false, reason: 'classifier chose unknown playbook "nope"' })
  })

  it('non-zero exit → ok:false regardless of output', async () => {
    const child = fakeChild()
    registerOrchestratorIpc(() => undefined, () => child, { source: makeSource(), promptsDir: () => dir })
    const p = handleMap.get(ORCHESTRATOR.classify)!({}, { id: 'c1', ticketKey: 'PROJ-1' }) as Promise<ClassifyResult>
    await flush()
    child.stdout('{"prompt": "fix-bug"}\n')
    child.exit(1)
    expect(await p).toEqual({ ok: false, reason: 'classifier exited with code 1' })
  })

  it('verdict prompt:null carries the reason', async () => {
    const child = fakeChild()
    registerOrchestratorIpc(() => undefined, () => child, { source: makeSource(), promptsDir: () => dir })
    const p = handleMap.get(ORCHESTRATOR.classify)!({}, { id: 'c1', ticketKey: 'PROJ-1' }) as Promise<ClassifyResult>
    await flush()
    child.stdout('{"prompt": null, "reason": "no fit"}\n')
    child.exit(0)
    expect(await p).toEqual({ ok: false, reason: 'no fit' })
  })

  it('exit with no JSON in output → ok:false', async () => {
    const child = fakeChild()
    registerOrchestratorIpc(() => undefined, () => child, { source: makeSource(), promptsDir: () => dir })
    const p = handleMap.get(ORCHESTRATOR.classify)!({}, { id: 'c1', ticketKey: 'PROJ-1' }) as Promise<ClassifyResult>
    await flush()
    child.stdout('I could not decide.\n')
    child.exit(0)
    expect(await p).toEqual({ ok: false, reason: 'classifier returned no JSON verdict' })
  })

  it('duplicate id is rejected while a run is live', async () => {
    const child = fakeChild()
    registerOrchestratorIpc(() => undefined, () => child, { source: makeSource(), promptsDir: () => dir })
    const p = handleMap.get(ORCHESTRATOR.classify)!({}, { id: 'c1', ticketKey: 'PROJ-1' }) as Promise<ClassifyResult>
    await flush()
    const dup = (await handleMap.get(ORCHESTRATOR.classify)!({}, { id: 'c1', ticketKey: 'PROJ-1' })) as ClassifyResult
    expect(dup).toEqual({ ok: false, reason: 'run already exists' })
    child.exit(0)
    await p
  })

  it('kill resolves the pending classify as a failure', async () => {
    const child = fakeChild()
    registerOrchestratorIpc(() => undefined, () => child, { source: makeSource(), promptsDir: () => dir })
    const p = handleMap.get(ORCHESTRATOR.classify)!({}, { id: 'c1', ticketKey: 'PROJ-1' }) as Promise<ClassifyResult>
    await flush()
    onMap.get(ORCHESTRATOR.kill)!({}, 'c1')
    expect(child.killed).toBe(true)
    // A real killed process still emits a non-zero exit → the runner's exit path fires.
    child.exit(143)
    expect(await p).toEqual({ ok: false, reason: 'classifier exited with code 143' })
  })
})

describe('orchestrator handlers — prompt read/save', () => {
  it('readPrompt returns the built-in preset and isDefault:true when no override', () => {
    registerOrchestratorIpc(() => undefined, () => fakeChild(), { source: makeSource(), promptsDir: () => dir })
    const info = handleMap.get(ORCHESTRATOR.readPrompt)!({}) as OrchestratorPromptInfo
    expect(info).toEqual({ text: DEFAULT_ORCHESTRATOR_PROMPT, isDefault: true })
  })

  it('savePrompt writes an override, flips isDefault, and broadcasts CONFIG.changed', () => {
    const send = vi.fn()
    registerOrchestratorIpc(() => ({ send } as unknown as Electron.WebContents), () => fakeChild(), { source: makeSource(), promptsDir: () => dir })
    const res = handleMap.get(ORCHESTRATOR.savePrompt)!({}, 'custom router {{ticket.key}}') as SaveResult
    expect(res).toEqual({ ok: true })
    expect(send).toHaveBeenCalledWith(CONFIG.changed)
    expect(existsSync(join(dir, ORCH_FILE))).toBe(true)
    const info = handleMap.get(ORCHESTRATOR.readPrompt)!({}) as OrchestratorPromptInfo
    expect(info).toEqual({ text: 'custom router {{ticket.key}}', isDefault: false })
  })

  it('saving the default text reverts to the built-in (override removed)', () => {
    registerOrchestratorIpc(() => undefined, () => fakeChild(), { source: makeSource(), promptsDir: () => dir })
    handleMap.get(ORCHESTRATOR.savePrompt)!({}, 'custom')
    handleMap.get(ORCHESTRATOR.savePrompt)!({}, DEFAULT_ORCHESTRATOR_PROMPT)
    expect(existsSync(join(dir, ORCH_FILE))).toBe(false)
  })
})
