import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigStore, requireConfig, TICKET_CACHE_MS } from './store'
import type { JiraClient } from '../jira/client'
import type { Ticket } from '../../shared/types'

const MINIMAL = 'jira:\n  baseUrl: https://x.atlassian.net\n  email: a@b.co\n  apiToken: t\n'

function tmpSetup(yaml: string): { store: ConfigStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sd-store-'))
  const cfgPath = join(dir, 'config.yaml')
  writeFileSync(cfgPath, yaml + `promptsDir: ${JSON.stringify(join(dir, 'prompts'))}\n`, 'utf8')
  return { store: new ConfigStore(cfgPath), dir }
}

describe('ConfigStore', () => {
  it('reload loads config and builds the jira client', () => {
    const { store } = tmpSetup(MINIMAL)
    expect(store.reload()).toEqual({ ok: true })
    expect(store.config?.jira.email).toBe('a@b.co')
    expect(store.jiraClient).not.toBeNull()
    expect(store.loadError).toBeNull()
  })
  it('reload failure keeps the last good config', () => {
    const { store } = tmpSetup(MINIMAL)
    store.reload()
    const clientBefore = store.jiraClient
    writeFileSync(store.configPath, 'jira: [broken', 'utf8')
    const res = store.reload()
    expect(res.ok).toBe(false)
    expect(store.config?.jira.email).toBe('a@b.co') // last-good preserved
    expect(store.loadError).toBeNull()              // loadError only set when NO good config exists
    expect(store.jiraClient).toBe(clientBefore)     // client survives a failed reload too
  })
  it('boot failure records loadError and getTicket throws it', async () => {
    const store = new ConfigStore(join(tmpdir(), 'sd-none', 'nope.yaml'))
    const res = store.reload()
    expect(res.ok).toBe(false)
    expect(store.config).toBeNull()
    expect(store.loadError).toBeTruthy()
    await expect(store.getTicket('P-1')).rejects.toThrow(/Config not loaded/)
  })
  it('reloadPrompts mutates the SAME array instance in place', () => {
    const { store, dir } = tmpSetup(MINIMAL)
    store.reload()
    const ref = store.prompts
    mkdirSync(join(dir, 'prompts'), { recursive: true })
    writeFileSync(join(dir, 'prompts', 'fix.md'), '---\nname: fix\ndescription: d\n---\nbody', 'utf8')
    store.reloadPrompts()
    expect(store.prompts).toBe(ref)                 // identity stable — handlers hold this reference
    expect(ref.map((p) => p.name)).toEqual(['fix'])
  })
})

const ticket: Ticket = { key: 'SD-6', type: 'Bug', status: 'Open', summary: 's', descriptionAdf: null, acceptanceCriteria: null, comments: [], url: 'u' }

function fakeClientStore(fetchIssue: (key: string) => Promise<Ticket>): { store: ConfigStore; calls: () => number } {
  let calls = 0
  const store = new ConfigStore('unused')
  store.jiraClient = { fetchIssue: (k: string) => { calls++; return fetchIssue(k) } } as unknown as JiraClient
  return { store, calls: () => calls }
}

describe('ConfigStore getTicket memoization', () => {
  afterEach(() => vi.useRealTimers())

  it('one fetch serves repeated reads of the same key within the TTL', async () => {
    const { store, calls } = fakeClientStore(async () => ticket)
    // Same shape as one yolo deep link: two concurrent renderer reads, then the
    // main-process classify read moments later.
    await Promise.all([store.getTicket('SD-6'), store.getTicket('SD-6')])
    await store.getTicket('SD-6')
    expect(calls()).toBe(1)
  })

  it('key lookup is case-insensitive like the rest of the app', async () => {
    const { store, calls } = fakeClientStore(async () => ticket)
    await store.getTicket('SD-6')
    await store.getTicket('sd-6')
    expect(calls()).toBe(1)
  })

  it('different keys fetch independently', async () => {
    const { store, calls } = fakeClientStore(async (k) => ({ ...ticket, key: k }))
    await store.getTicket('SD-6')
    await store.getTicket('SD-7')
    expect(calls()).toBe(2)
  })

  it('re-fetches once the TTL has passed', async () => {
    vi.useFakeTimers()
    const { store, calls } = fakeClientStore(async () => ticket)
    await store.getTicket('SD-6')
    vi.advanceTimersByTime(TICKET_CACHE_MS + 1)
    await store.getTicket('SD-6')
    expect(calls()).toBe(2)
  })

  it('does not cache failures', async () => {
    let fail = true
    const { store, calls } = fakeClientStore(async () => {
      if (fail) throw new Error('jira down')
      return ticket
    })
    await expect(store.getTicket('SD-6')).rejects.toThrow('jira down')
    fail = false
    await expect(store.getTicket('SD-6')).resolves.toEqual(ticket)
    expect(calls()).toBe(2)
  })

  it('reload clears the cache', async () => {
    const { store: tmp } = tmpSetup(MINIMAL)
    let calls = 0
    tmp.reload()
    tmp.jiraClient = { fetchIssue: async () => { calls++; return ticket } } as unknown as JiraClient
    await tmp.getTicket('SD-6')
    tmp.reload() // fresh config/client → stale tickets must not survive
    tmp.jiraClient = { fetchIssue: async () => { calls++; return ticket } } as unknown as JiraClient
    await tmp.getTicket('SD-6')
    expect(calls).toBe(2)
  })
})

describe('requireConfig', () => {
  it('throws with the load error when config is null', () => {
    const store = new ConfigStore(join(tmpdir(), 'sd-none', 'missing.yaml'))
    store.reload()
    expect(() => requireConfig(store)).toThrow(/Config not loaded/)
    const { store: good } = tmpSetup(MINIMAL)
    good.reload()
    expect(requireConfig(good).jira.email).toBe('a@b.co')
  })
})
