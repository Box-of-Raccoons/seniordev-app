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

describe('JiraClient.search', () => {
  it('POSTs JQL to /search/jql and normalizes issues', async () => {
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toContain('/rest/api/3/search/jql')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string).jql).toBe('assignee = currentUser()')
      return { ok: true, status: 200, json: async () => ({ issues: [fixture] }) } as Response
    })
    const client = new JiraClient(cfg, fetchFn as unknown as typeof fetch)
    const tickets = await client.search('assignee = currentUser()')
    expect(tickets).toHaveLength(1)
    expect(tickets[0].summary).toBe('Login button dead on iOS')
  })

  it('returns [] when the response has no issues', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) } as Response))
    const client = new JiraClient(cfg, fetchFn as unknown as typeof fetch)
    expect(await client.search('x')).toEqual([])
  })

  it('throws on a non-ok search response', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 400, statusText: 'Bad Request' } as Response))
    const client = new JiraClient(cfg, fetchFn as unknown as typeof fetch)
    await expect(client.search('bad')).rejects.toThrow(/400/)
  })
})

describe('JiraClient.transition', () => {
  it('resolves the transition id by name (case-insensitive) and POSTs it', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (!init?.method || init.method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ transitions: [{ id: '31', name: 'In Progress' }] }) } as Response
      }
      return { ok: true, status: 204 } as Response
    })
    const client = new JiraClient(cfg, fetchFn as unknown as typeof fetch)
    await client.transition('PROJ-1', 'in progress')
    const post = calls.find((c) => c.init?.method === 'POST')!
    expect(post.url).toContain('/rest/api/3/issue/PROJ-1/transitions')
    expect(JSON.parse(post.init!.body as string)).toEqual({ transition: { id: '31' } })
  })

  it('throws a distinguishable error when no transition matches the name', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ transitions: [{ id: '1', name: 'Done' }] }) } as Response))
    const client = new JiraClient(cfg, fetchFn as unknown as typeof fetch)
    await expect(client.transition('PROJ-1', 'In Progress')).rejects.toThrow(/No transition named "In Progress"/)
  })
})
