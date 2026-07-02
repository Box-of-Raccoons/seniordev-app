import type { Ticket } from '../../shared/types'
import { normalizeIssue } from './normalize'

export interface JiraConfig {
  baseUrl: string
  email: string
  apiToken: string
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

  async fetchIssue(key: string): Promise<Ticket> {
    const base = this.cfg.baseUrl.replace(/\/$/, '')
    const url = `${base}/rest/api/3/issue/${encodeURIComponent(key)}?fields=${FIELDS}`
    const res = await this.fetchFn(url, {
      headers: { Authorization: this.authHeader(), Accept: 'application/json' }
    })
    if (!res.ok) {
      throw new Error(`Jira request failed (${res.status} ${res.statusText || ''}) for ${key}`)
    }
    const raw = await res.json()
    return normalizeIssue(raw, base)
  }
}
