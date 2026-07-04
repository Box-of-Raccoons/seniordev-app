import type { Config } from '../config/schema'
import type { ConfigSource } from '../config/store'
import type { ClassifyRequest, ClassifyResult } from '../../shared/ipc'
import { buildHeadlessLaunch, type HeadlessLaunch } from '../headless/launch'
import { createParser } from '../headless/parsers'
import { YoloRunner, type HeadlessSpawner } from '../headless/runner'
import type { ForgePattern } from '../terminal/pr-detector'
import { buildPromptTicket, expandPrompt, resolveForge } from '../prompts/expand'
import { findPrompt, type PromptTemplate } from '../prompts/library'
import { readOrchestratorFile } from '../prompts/files'
import { buildCatalog } from './catalog'
import { extractVerdict } from './extract'
import type { ResolvedCommand } from '../terminal/resolve-command'

// Never guess-and-run: any failure (non-zero exit, no verdict, explicit null,
// unknown name) yields ok:false so stage 2 is unreachable.
export function finalize(exitCode: number, buffer: string, prompts: PromptTemplate[]): ClassifyResult {
  if (exitCode !== 0) return { ok: false, reason: `classifier exited with code ${exitCode}` }
  const verdict = extractVerdict(buffer)
  if (!verdict) return { ok: false, reason: 'classifier returned no JSON verdict' }
  if (verdict.prompt === null) return { ok: false, reason: verdict.reason ?? 'no playbook fits this ticket' }
  if (!findPrompt(prompts, verdict.prompt)) return { ok: false, reason: `classifier chose unknown playbook "${verdict.prompt}"` }
  return { ok: true, prompt: verdict.prompt }
}

// Stage-1 launch: full ticket (ignore config.ticketContext privacy mode — a
// classifier routing on a bare key returns garbage) + catalog, bare:true so no
// yoloPreamble/recap wraps the "answer with only JSON" contract.
export async function buildClassifyLaunch(
  config: Config,
  source: ConfigSource,
  promptsDir: string,
  req: ClassifyRequest,
  resolveCommand?: (command: string) => ResolvedCommand | undefined
): Promise<HeadlessLaunch> {
  const template = readOrchestratorFile(promptsDir)
  const ticket = await source.getTicket(req.ticketKey)
  const ticketCtx = buildPromptTicket(ticket, 'both')
  const forge = resolveForge(config, req.ticketKey)
  const expanded = expandPrompt(template, {
    ticket: ticketCtx,
    forge,
    contextTemplate: source.contextTemplate?.(),
    catalog: buildCatalog(source.prompts)
  })
  return buildHeadlessLaunch(config, { tool: req.tool, ticketKey: req.ticketKey, bare: true }, expanded, resolveCommand)
}

export interface ClassifyEngine {
  run(id: string, launch: HeadlessLaunch, prompts: PromptTemplate[], patterns: ForgePattern[]): Promise<ClassifyResult>
  has(id: string): boolean
  kill(id: string): void
  killAll(): void
}

// Owns a YoloRunner and, per run id, accumulates stdout for verdict extraction
// and holds the promise resolver its exit settles.
export function createClassifyRunner(
  spawner: HeadlessSpawner,
  onLog: (id: string, text: string) => void
): ClassifyEngine {
  const buffers = new Map<string, string>()
  const pending = new Map<string, (r: ClassifyResult) => void>()
  const promptsById = new Map<string, PromptTemplate[]>()

  const runner = new YoloRunner(spawner, {
    onLog: (id, text) => {
      onLog(id, text)
      buffers.set(id, (buffers.get(id) ?? '') + text + '\n')
    },
    onPr: () => {}, // a classify-only turn must not open PRs
    onExit: (id, e) => {
      const resolve = pending.get(id)
      const buffer = buffers.get(id) ?? ''
      const prompts = promptsById.get(id) ?? []
      pending.delete(id)
      buffers.delete(id)
      promptsById.delete(id)
      resolve?.(finalize(e.exitCode, buffer, prompts))
    }
  })

  return {
    has: (id) => runner.has(id),
    kill: (id) => runner.kill(id),
    killAll: () => runner.killAll(),
    run(id, launch, prompts, patterns) {
      return new Promise<ClassifyResult>((resolve) => {
        pending.set(id, resolve)
        buffers.set(id, '')
        promptsById.set(id, prompts)
        runner.start(id, {
          file: launch.file,
          args: launch.args,
          cwd: launch.cwd,
          prompt: launch.prompt,
          parser: createParser(launch.outputParser, launch.sessionIdPattern),
          patterns,
          resolved: launch.resolved
        })
      })
    }
  }
}
