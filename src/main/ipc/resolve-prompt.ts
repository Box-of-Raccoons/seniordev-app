import type { Config } from '../config/schema'
import type { Ticket } from '../../shared/types'
import type { PromptModel } from '../config/model'
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

// The expanded prompt plus the model it declared (if any), so the chosen
// prompt's model can ride alongside the text into the launch builders. `model`
// is only the prompt's frontmatter value — the tool's defaultModel fallback is
// resolved later, at launch (see resolveModelArgs).
export interface ResolvedPrompt {
  prompt: string
  model?: PromptModel
}

export async function resolveExpandedPrompt(
  config: Config,
  deps: PromptDeps,
  req: PromptRequest
): Promise<ResolvedPrompt | undefined> {
  if (!req.prompt) return undefined
  let body = req.prompt.text
  let model: PromptModel | undefined
  if (req.prompt.name) {
    const tmpl = findPrompt(deps.prompts, req.prompt.name)
    if (!tmpl) throw new Error(`Unknown prompt: ${req.prompt.name}`)
    body = tmpl.body
    model = tmpl.model
  }
  if (body === undefined) return undefined

  const ticket = req.ticketKey
    ? await deps.getTicket(req.ticketKey)
    : { key: '', type: '', status: '', summary: '', descriptionAdf: null, acceptanceCriteria: null, comments: [], url: '' }
  const ticketCtx = buildPromptTicket(ticket, config.ticketContext)
  const forge = resolveForge(config, req.ticketKey)
  const prompt = expandPrompt(body, { ticket: ticketCtx, forge, contextTemplate: deps.contextTemplate?.() })
  return { prompt, model }
}
