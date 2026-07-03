// Single source of truth for the Jira ticket-key grammar (PROJ-123). The README
// bookmarklets embed the same pattern — keep them in sync when changing this.
export const TICKET_KEY = /^[A-Za-z][A-Za-z0-9]*-\d+$/

export function isTicketKey(s: string): boolean {
  return TICKET_KEY.test(s)
}
