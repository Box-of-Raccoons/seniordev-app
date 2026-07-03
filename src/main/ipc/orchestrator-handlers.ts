import { ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { requireConfig } from '../config/store'
import {
  CONFIG, ORCHESTRATOR, YOLO,
  type ClassifyRequest, type ClassifyResult, type OrchestratorPromptInfo, type SaveResult
} from '../../shared/ipc'
import { buildHeadlessLaunch } from '../headless/launch'
import { createParser } from '../headless/parsers'
import { YoloRunner, type HeadlessSpawner } from '../headless/runner'
import { buildForgePatterns } from '../terminal/pr-detector'
import { buildPromptTicket, expandPrompt, resolveForge } from '../prompts/expand'
import { findPrompt, type PromptTemplate } from '../prompts/library'
import { ORCHESTRATOR_FILE, readOrchestratorFile, writeOrchestratorFile } from '../prompts/files'
import { buildCatalog } from '../orchestrator/catalog'
import { extractVerdict } from '../orchestrator/extract'
import type { TerminalDeps } from './terminal-handlers'

// Never guess-and-run: any failure (non-zero exit, no verdict, explicit null,
// unknown name) yields ok:false so stage 2 is unreachable.
function finalize(exitCode: number, buffer: string, prompts: PromptTemplate[]): ClassifyResult {
  if (exitCode !== 0) return { ok: false, reason: `classifier exited with code ${exitCode}` }
  const verdict = extractVerdict(buffer)
  if (!verdict) return { ok: false, reason: 'classifier returned no JSON verdict' }
  if (verdict.prompt === null) return { ok: false, reason: verdict.reason ?? 'no playbook fits this ticket' }
  if (!findPrompt(prompts, verdict.prompt)) return { ok: false, reason: `classifier chose unknown playbook "${verdict.prompt}"` }
  return { ok: true, prompt: verdict.prompt }
}

export function registerOrchestratorIpc(
  getSender: () => Electron.WebContents | undefined,
  spawner: HeadlessSpawner,
  deps: TerminalDeps & { promptsDir: () => string }
): YoloRunner {
  // Per-run stdout, accumulated for verdict extraction, and the resolver of the
  // classify() promise that this run's exit settles — both keyed by run id.
  const buffers = new Map<string, string>()
  const pending = new Map<string, (r: ClassifyResult) => void>()

  const runner = new YoloRunner(spawner, {
    // Same channel the YOLO tab uses; the renderer filters by id. Also buffer the
    // line so the exit path can extract the JSON verdict.
    onLog: (id, text) => {
      getSender()?.send(YOLO.log, { id, text })
      buffers.set(id, (buffers.get(id) ?? '') + text + '\n')
    },
    onPr: () => {}, // a classify-only turn must not open PRs — ignore any match
    onExit: (id, e) => {
      const resolve = pending.get(id)
      const buffer = buffers.get(id) ?? ''
      pending.delete(id)
      buffers.delete(id)
      resolve?.(finalize(e.exitCode, buffer, deps.source.prompts))
    }
  })

  ipcMain.handle(ORCHESTRATOR.classify, async (_e, req: ClassifyRequest): Promise<ClassifyResult> => {
    try {
      const config = requireConfig(deps.source)
      // Check BEFORE any registration: a duplicate id must not clobber the live
      // run's buffer/resolver on its way to the runner's throw.
      if (runner.has(req.id)) return { ok: false, reason: 'run already exists' }

      const template = readOrchestratorFile(deps.promptsDir())
      const ticket = await deps.source.getTicket(req.ticketKey)
      // Always 'both', ignoring config.ticketContext: that privacy mode shapes
      // interactive/yolo prompts, but a classifier routing on a bare key would
      // deterministically return garbage — it needs the ticket's content.
      const ticketCtx = buildPromptTicket(ticket, 'both')
      const forge = resolveForge(config, req.ticketKey)
      const expanded = expandPrompt(template, {
        ticket: ticketCtx,
        forge,
        contextTemplate: deps.source.contextTemplate?.(),
        catalog: buildCatalog(deps.source.prompts)
      })
      // bare:true — no preamble/recap wrapping (see buildHeadlessLaunch).
      const launch = buildHeadlessLaunch(config, { tool: req.tool, ticketKey: req.ticketKey, bare: true }, expanded, deps.resolveCommand)

      return await new Promise<ClassifyResult>((resolve) => {
        pending.set(req.id, resolve)
        buffers.set(req.id, '')
        runner.start(req.id, {
          file: launch.file,
          args: launch.args,
          cwd: launch.cwd,
          prompt: launch.prompt,
          parser: createParser(launch.outputParser, launch.sessionIdPattern),
          patterns: buildForgePatterns(config), // required by the runner API; PRs are ignored
          resolved: launch.resolved
        })
      })
    } catch (err) {
      pending.delete(req.id)
      buffers.delete(req.id)
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  })

  // A killed child still fires its exit callback (non-zero), which resolves the
  // pending classify as a failure.
  ipcMain.on(ORCHESTRATOR.kill, (_e, id: string) => runner.kill(id))

  ipcMain.handle(ORCHESTRATOR.readPrompt, (): OrchestratorPromptInfo => ({
    text: readOrchestratorFile(deps.promptsDir()),
    isDefault: !existsSync(join(deps.promptsDir(), ORCHESTRATOR_FILE))
  }))

  ipcMain.handle(ORCHESTRATOR.savePrompt, (_e, text: string): SaveResult => {
    try {
      writeOrchestratorFile(deps.promptsDir(), text)
      // The file is read fresh at each classify, so no config reload is needed —
      // but nudge any open Prompt Config UI to refresh its isDefault badge.
      getSender()?.send(CONFIG.changed)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  return runner
}
