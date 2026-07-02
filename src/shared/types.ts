export interface AdfNode {
  type: string
  content?: AdfNode[]
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  attrs?: Record<string, unknown>
}

export interface TicketComment {
  author: string
  createdIso: string
  bodyAdf: AdfNode | null
}

export interface Ticket {
  key: string
  type: string
  status: string
  summary: string
  descriptionAdf: AdfNode | null
  acceptanceCriteria: string | null
  comments: TicketComment[]
  url: string
}
