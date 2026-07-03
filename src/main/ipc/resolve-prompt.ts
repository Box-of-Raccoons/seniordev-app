import type { Config } from '../config/schema'
import type { Ticket } from '../../shared/types'
import { type PromptTemplate, findPrompt } from '../prompts/library'
import { buildPromptTicket, expandPrompt, resolveForge } from '../prompts/expand'

export interface PromptRequest {
  prompt?: { name?: string; text?: string }
  ticketKey?: string
}

export interface PromptDeps {
  getTicket: (key: string) => Promise<Ticket>
  prompts: PromptTemplate[]
  contextTemplate?: () => string
}

export async function resolveExpandedPrompt(
  config: Config,
  deps: PromptDeps,
  req: PromptRequest
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
  return expandPrompt(body, { ticket: ticketCtx, forge, contextTemplate: deps.contextTemplate?.() })
}
