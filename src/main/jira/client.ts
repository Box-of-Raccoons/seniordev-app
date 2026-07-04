import type { Ticket } from '../../shared/types'
import { normalizeIssue, type RawIssue } from './normalize'

export interface JiraConfig {
  baseUrl: string
  email: string
  apiToken: string
}

export interface JiraTransition {
  id: string
  name: string
}

const FIELDS = 'summary,status,issuetype,description,comment'

export class JiraClient {
  constructor(
    private readonly cfg: JiraConfig,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  private authHeader(): string {
    const token = Buffer.from(`${this.cfg.email}:${this.cfg.apiToken}`).toString('base64')
    return `Basic ${token}`
  }

  private base(): string {
    return this.cfg.baseUrl.replace(/\/$/, '')
  }

  private jsonHeaders(): Record<string, string> {
    return { Authorization: this.authHeader(), Accept: 'application/json', 'Content-Type': 'application/json' }
  }

  async fetchIssue(key: string): Promise<Ticket> {
    const url = `${this.base()}/rest/api/3/issue/${encodeURIComponent(key)}?fields=${FIELDS}`
    const res = await this.fetchFn(url, {
      headers: { Authorization: this.authHeader(), Accept: 'application/json' }
    })
    if (!res.ok) {
      throw new Error(`Jira request failed (${res.status} ${res.statusText || ''}) for ${key}`)
    }
    const raw = await res.json()
    return normalizeIssue(raw, this.base())
  }

  // Enhanced search endpoint (the old GET /rest/api/3/search is deprecated).
  // v1 takes the first page (maxResults 50); pagination is a follow-up.
  async search(jql: string): Promise<Ticket[]> {
    const res = await this.fetchFn(`${this.base()}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify({ jql, fields: FIELDS.split(','), maxResults: 50 })
    })
    if (!res.ok) throw new Error(`Jira search failed (${res.status} ${res.statusText || ''})`)
    const raw = (await res.json()) as { issues?: RawIssue[] }
    return (raw.issues ?? []).map((i) => normalizeIssue(i, this.base()))
  }

  async getTransitions(key: string): Promise<JiraTransition[]> {
    const res = await this.fetchFn(`${this.base()}/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
      headers: { Authorization: this.authHeader(), Accept: 'application/json' }
    })
    if (!res.ok) throw new Error(`Jira transitions fetch failed (${res.status}) for ${key}`)
    const raw = (await res.json()) as { transitions?: JiraTransition[] }
    return (raw.transitions ?? []).map((t) => ({ id: t.id, name: t.name }))
  }

  async transition(key: string, transitionName: string): Promise<void> {
    const match = (await this.getTransitions(key)).find(
      (t) => t.name.toLowerCase() === transitionName.toLowerCase()
    )
    if (!match) throw new Error(`No transition named "${transitionName}" available on ${key}`)
    const res = await this.fetchFn(`${this.base()}/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify({ transition: { id: match.id } })
    })
    if (!res.ok) throw new Error(`Jira transition failed (${res.status}) for ${key}`)
  }
}
