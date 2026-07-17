import type { Config } from '../config/schema'
import type { PromptModel } from '../config/model'
import { type PromptTemplate, findPrompt } from '../prompts/library'
import { buildPromptTicket, expandPrompt, resolveForge } from '../prompts/expand'

export interface PromptRequest {
  prompt?: { name?: string; text?: string }
  ticketKey?: string
  // The raw composer input (ticket key or free text) → {{request}}.
  input?: string
}

export interface PromptDeps {
  prompts: PromptTemplate[]
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

  // Key-only: the ticket key is injected as a string and the agent reads the
  // ticket itself via its Atlassian MCP. We never fetch it app-side, so the
  // {{ticket.*}} body fields other than {{ticket.key}} expand empty by design.
  const ticketCtx = buildPromptTicket(
    { key: req.ticketKey ?? '', type: '', status: '', summary: '', descriptionAdf: null, acceptanceCriteria: null, comments: [], url: '' },
    'key-only'
  )
  const forge = resolveForge(config, req.ticketKey)
  const prompt = expandPrompt(body, { ticket: ticketCtx, forge, request: req.input })
  return { prompt, model }
}
