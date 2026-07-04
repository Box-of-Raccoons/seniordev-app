import { ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { requireConfig } from '../config/store'
import {
  CONFIG, ORCHESTRATOR, YOLO,
  type ClassifyRequest, type ClassifyResult, type OrchestratorPromptInfo, type SaveResult
} from '../../shared/ipc'
import { buildForgePatterns } from '../terminal/pr-detector'
import { type HeadlessSpawner } from '../headless/runner'
import { ORCHESTRATOR_FILE, readOrchestratorFile, writeOrchestratorFile } from '../prompts/files'
import { buildClassifyLaunch, createClassifyRunner, type ClassifyEngine } from '../orchestrator/run'
import type { TerminalDeps } from './terminal-handlers'

export function registerOrchestratorIpc(
  getSender: () => Electron.WebContents | undefined,
  spawner: HeadlessSpawner,
  deps: TerminalDeps & { promptsDir: () => string }
): ClassifyEngine {
  const engine = createClassifyRunner(spawner, (id, text) => getSender()?.send(YOLO.log, { id, text }))

  ipcMain.handle(ORCHESTRATOR.classify, async (_e, req: ClassifyRequest): Promise<ClassifyResult> => {
    try {
      const config = requireConfig(deps.source)
      // Check BEFORE building: a duplicate id must not clobber the live run.
      if (engine.has(req.id)) return { ok: false, reason: 'run already exists' }
      const launch = await buildClassifyLaunch(config, deps.source, deps.promptsDir(), req, deps.resolveCommand)
      return await engine.run(req.id, launch, deps.source.prompts, buildForgePatterns(config))
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  })

  // A killed child still fires its exit callback (non-zero), which resolves the
  // pending classify as a failure.
  ipcMain.on(ORCHESTRATOR.kill, (_e, id: string) => engine.kill(id))

  ipcMain.handle(ORCHESTRATOR.readPrompt, (): OrchestratorPromptInfo => ({
    text: readOrchestratorFile(deps.promptsDir()),
    isDefault: !existsSync(join(deps.promptsDir(), ORCHESTRATOR_FILE))
  }))

  ipcMain.handle(ORCHESTRATOR.savePrompt, (_e, text: string): SaveResult => {
    try {
      writeOrchestratorFile(deps.promptsDir(), text)
      getSender()?.send(CONFIG.changed)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  return engine
}
