import type { Ticket } from './types'

export type GetTicketResult = { ok: true; ticket: Ticket } | { ok: false; error: string }

export const IPC = { getTicket: 'jira:getTicket' } as const
