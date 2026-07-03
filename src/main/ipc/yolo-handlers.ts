import { ipcMain } from 'electron'
import type { Config } from '../config/schema'
import { YOLO, type SpawnResult, type StartYoloRequest, type YoloCaps } from '../../shared/ipc'
import { buildHeadlessLaunch } from '../headless/launch'
import { createParser } from '../headless/parsers'
import { YoloRunner, type HeadlessSpawner } from '../headless/runner'
import { buildForgePatterns } from '../terminal/pr-detector'
import { resolveExpandedPrompt } from './resolve-prompt'
import type { TerminalDeps } from './terminal-handlers'

export function registerYoloIpc(
  config: Config,
  getSender: () => Electron.WebContents | undefined,
  spawner: HeadlessSpawner,
  deps: TerminalDeps
): YoloRunner {
  // Per-run context the exit event needs (resume cwd/tool) — keyed by run id.
  const meta = new Map<string, { cwd: string; tool: string; canResume: boolean }>()

  const runner = new YoloRunner(spawner, {
    onLog: (id, text) => getSender()?.send(YOLO.log, { id, text }),
    onPr: (id, url, term) => getSender()?.send(YOLO.pr, { id, url, term }),
    onExit: (id, e) => {
      const m = meta.get(id)
      meta.delete(id)
      getSender()?.send(YOLO.exit, {
        id,
        exitCode: e.exitCode,
        sessionId: e.sessionId,
        cwd: m?.cwd ?? '',
        tool: m?.tool ?? '',
        canResume: Boolean(e.sessionId) && (m?.canResume ?? false),
        prUrls: e.prUrls
      })
    }
  })

  ipcMain.handle(YOLO.start, async (_e, req: StartYoloRequest): Promise<SpawnResult> => {
    try {
      if (!req.prompt?.name && !req.prompt?.text) throw new Error('YOLO session requires a prompt')
      const expanded = await resolveExpandedPrompt(config, deps, req)
      const launch = buildHeadlessLaunch(config, req, expanded ?? '', deps.resolveCommand)
      meta.set(req.id, { cwd: launch.cwd, tool: launch.toolName, canResume: launch.canResume })
      runner.start(req.id, {
        file: launch.file,
        args: launch.args,
        cwd: launch.cwd,
        prompt: launch.prompt,
        parser: createParser(launch.outputParser, launch.sessionIdPattern),
        patterns: buildForgePatterns(config),
        resolved: launch.resolved
      })
      return { ok: true }
    } catch (err) {
      meta.delete(req.id)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(YOLO.caps, (): YoloCaps => ({
    available: Boolean(config.cliTools[config.defaultTool]?.headless)
  }))

  ipcMain.on(YOLO.kill, (_e, id: string) => {
    runner.kill(id)
    meta.delete(id)
  })

  return runner
}
