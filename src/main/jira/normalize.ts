import type { Ticket, TicketComment, AdfNode } from '../../shared/types'

interface RawComment {
  author?: { displayName?: string }
  created?: string
  body?: AdfNode | null
}
export interface RawIssue {
  key: string
  fields?: {
    summary?: string
    status?: { name?: string }
    issuetype?: { name?: string }
    description?: AdfNode | null
    comment?: { comments?: RawComment[] }
  }
}

export function normalizeIssue(raw: RawIssue, baseUrl: string): Ticket {
  const f = raw.fields ?? {}
  const comments: TicketComment[] = (f.comment?.comments ?? []).map((c) => ({
    author: c.author?.displayName ?? 'Unknown',
    createdIso: c.created ?? '',
    bodyAdf: c.body ?? null
  }))
  const base = baseUrl.replace(/\/$/, '')
  return {
    key: raw.key,
    type: f.issuetype?.name ?? '',
    status: f.status?.name ?? '',
    summary: f.summary ?? '',
    descriptionAdf: f.description ?? null,
    acceptanceCriteria: null,
    comments,
    url: `${base}/browse/${raw.key}`
  }
}
