import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JiraClient } from './client'

const fixture = JSON.parse(
  readFileSync(join(__dirname, '../../../test/fixtures/issue-basic.json'), 'utf8')
)
const cfg = { baseUrl: 'https://acme.atlassian.net', email: 'dev@acme.com', apiToken: 'tok' }

describe('JiraClient.fetchIssue', () => {
  it('calls the v3 issue endpoint with basic auth and returns a Ticket', async () => {
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toContain('/rest/api/3/issue/PROJ-123')
      expect((init.headers as Record<string, string>).Authorization).toBe(
        'Basic ' + Buffer.from('dev@acme.com:tok').toString('base64')
      )
      return { ok: true, status: 200, json: async () => fixture } as Response
    })
    const client = new JiraClient(cfg, fetchFn as unknown as typeof fetch)
    const t = await client.fetchIssue('PROJ-123')
    expect(t.summary).toBe('Login button dead on iOS')
  })

  it('throws on a non-ok response', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 404, statusText: 'Not Found' } as Response))
    const client = new JiraClient(cfg, fetchFn as unknown as typeof fetch)
    await expect(client.fetchIssue('NOPE-1')).rejects.toThrow(/404/)
  })
})
