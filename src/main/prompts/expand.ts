import type { Ticket } from '../../shared/types'
import type { Config } from '../config/schema'
import { adfToMarkdown } from '../../shared/adf-to-markdown'

export interface PromptTicket {
  key: string
  type: string
  status: string
  summary: string
  descriptionMd: string
  acceptanceCriteria: string
  commentsMd: string
}

const EMPTY = { type: '', status: '', summary: '', descriptionMd: '', acceptanceCriteria: '', commentsMd: '' }

export function buildPromptTicket(ticket: Ticket, mode: 'key-only' | 'both'): PromptTicket {
  if (mode === 'key-only') return { key: ticket.key, ...EMPTY }
  const commentsMd = ticket.comments
    .map((c) => `**${c.author}**: ${adfToMarkdown(c.bodyAdf)}`)
    .join('\n\n')
  return {
    key: ticket.key,
    type: ticket.type,
    status: ticket.status,
    summary: ticket.summary,
    descriptionMd: adfToMarkdown(ticket.descriptionAdf),
    acceptanceCriteria: ticket.acceptanceCriteria ?? '',
    commentsMd
  }
}

export function resolveForge(config: Config, ticketKey?: string): { prCommand: string; term: string } {
  let forgeName = config.defaultForge
  if (ticketKey) {
    const project = ticketKey.split('-')[0].toUpperCase()
    const repo = config.repos.find((r) => r.key.toUpperCase() === project)
    if (repo?.forge) forgeName = repo.forge
  }
  const forge = config.forges[forgeName] ?? config.forges[config.defaultForge]
  return { prCommand: forge?.prCommand ?? '', term: forge?.term ?? 'PR' }
}

export function expandPrompt(
  body: string,
  ctx: { ticket: PromptTicket; forge: { prCommand: string; term: string }; request?: string }
): string {
  const map: Record<string, string> = {
    // {{request}} carries the real content under key-only (the ticket key or a
    // free-text task); the ticket.* text fields are empty unless a full ticket was
    // built with mode 'both'. An unknown placeholder is left literal.
    'request': ctx.request ?? '',
    'ticket.key': ctx.ticket.key,
    'ticket.type': ctx.ticket.type,
    'ticket.status': ctx.ticket.status,
    'ticket.summary': ctx.ticket.summary,
    'ticket.description': ctx.ticket.descriptionMd,
    'ticket.acceptanceCriteria': ctx.ticket.acceptanceCriteria,
    'ticket.comments': ctx.ticket.commentsMd,
    'forge.prCommand': ctx.forge.prCommand,
    'forge.term': ctx.forge.term
  }
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, key: string) => (key in map ? map[key] : m))
}
