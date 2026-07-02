import { ipcMain } from 'electron'
import type { Config } from '../config/schema'
import type { Ticket } from '../../shared/types'
import { TerminalManager, type PtySpawner } from '../terminal/manager'
import { buildInteractiveLaunch } from '../terminal/session'
import { TERM, type SpawnTerminalRequest, type SpawnResult } from '../../shared/ipc'
import { type PromptTemplate, findPrompt } from '../prompts/library'
import { buildPromptTicket, expandPrompt, resolveForge } from '../prompts/expand'
import { PrDetector, buildForgePatterns } from '../terminal/pr-detector'

export interface TerminalDeps {
  getTicket: (key: string) => Promise<Ticket>
  prompts: PromptTemplate[]
}

// Interactive CLIs need a moment to boot before they accept typed input.
const STDIN_PROMPT_DELAY_MS = 800

async function resolveExpandedPrompt(
  config: Config,
  deps: TerminalDeps,
  req: SpawnTerminalRequest
): Promise<string | undefined> {
  if (!req.prompt) return undefined
  let body = req.prompt.text
  if (req.prompt.name) {
    const tmpl = findPrompt(deps.prompts, req.prompt.name)
    if (!tmpl) throw new Error(`Unknown prompt: ${req.prompt.name}`)
    body = tmpl.body
  }
  if (body === undefined) return undefined

  const ticket = req.ticketKey
    ? await deps.getTicket(req.ticketKey)
    : { key: '', type: '', status: '', summary: '', descriptionAdf: null, acceptanceCriteria: null, comments: [], url: '' }
  const ticketCtx = buildPromptTicket(ticket, config.ticketContext)
  const forge = resolveForge(config, req.ticketKey)
  return expandPrompt(body, { ticket: ticketCtx, forge })
}

export function registerTerminalIpc(
  config: Config,
  getSender: () => Electron.WebContents | undefined,
  spawner: PtySpawner,
  deps: TerminalDeps
): TerminalManager {
  const detectors = new Map<string, PrDetector>()

  const manager = new TerminalManager(spawner, {
    onData: (id, data) => {
      getSender()?.send(TERM.data, { id, data })
      const det = detectors.get(id)
      if (det) {
        const hit = det.feed(data)
        if (hit) getSender()?.send(TERM.pr, { id, url: hit.url, term: hit.term })
      }
    },
    onExit: (id, exitCode) => {
      getSender()?.send(TERM.exit, { id, exitCode })
      detectors.delete(id)
    }
  })

  ipcMain.handle(TERM.spawn, async (_e, req: SpawnTerminalRequest): Promise<SpawnResult> => {
    try {
      const expanded = await resolveExpandedPrompt(config, deps, req)
      const launch = buildInteractiveLaunch(config, req, expanded)
      manager.spawn(req.id, { file: launch.file, args: launch.args, cwd: launch.cwd, cols: req.cols, rows: req.rows })
      if (req.yolo) detectors.set(req.id, new PrDetector(buildForgePatterns(config)))
      if (launch.stdinPrompt) {
        const prompt = launch.stdinPrompt
        setTimeout(() => manager.write(req.id, prompt + '\r'), STDIN_PROMPT_DELAY_MS)
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.on(TERM.write, (_e, id: string, data: string) => manager.write(id, data))
  ipcMain.on(TERM.resize, (_e, id: string, cols: number, rows: number) => manager.resize(id, cols, rows))
  ipcMain.on(TERM.kill, (_e, id: string) => manager.kill(id))

  return manager
}
