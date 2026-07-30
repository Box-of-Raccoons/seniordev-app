import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionPersistence } from './session-persistence'
import { createProjectsStore } from './store/projects-store'
import { createConversationsStore } from './store/conversations-store'

function stores(dir: string, now: () => number, newId: () => string) {
  return {
    projects: createProjectsStore({ file: join(dir, 'projects.json'), now, newId }),
    conversations: createConversationsStore({ file: join(dir, 'conversations.json'), now })
  }
}

describe('session persistence: agent spawn', () => {
  let dir: string
  let n: number
  const now = (): number => 1000
  const newId = (): string => `proj-${++n}`
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('claude: auto-creates the project and records agentSessionId == conversationId at spawn', () => {
    dir = mkdtempSync(join(tmpdir(), 'persist-'))
    n = 0
    const { projects, conversations } = stores(dir, now, newId)
    const p = createSessionPersistence({
      projects,
      conversations,
      discover: async () => 'SHOULD-NOT-BE-CALLED'
    })
    p.onAgentSpawn({
      conversationId: 'conv-abc',
      tool: 'claude',
      cwd: '/Users/h/code/app',
      title: 'session · app',
      preAssignedSessionId: 'conv-abc'
    })
    expect(projects.list()).toHaveLength(1)
    expect(projects.list()[0]).toMatchObject({ title: 'app', path: '/Users/h/code/app', defaultTool: 'claude' })
    const conv = conversations.get('conv-abc')
    expect(conv).toMatchObject({ tool: 'claude', agentSessionId: 'conv-abc', projectId: 'proj-1' })
  })

  it('codex: records the conversation with a null id, then fills it when discovery resolves', async () => {
    dir = mkdtempSync(join(tmpdir(), 'persist-'))
    n = 0
    const { projects, conversations } = stores(dir, now, newId)
    let discoverCalls = 0
    const p = createSessionPersistence({
      projects,
      conversations,
      discover: async (opts) => {
        discoverCalls += 1
        expect(opts.cwd).toBe('/Users/h/code/app')
        return 'discovered-codex-id'
      }
    })
    p.onAgentSpawn({ conversationId: 'conv-xyz', tool: 'codex', cwd: '/Users/h/code/app', title: 'session · app' })
    // At spawn, agentSessionId is null (discovery not yet resolved).
    expect(conversations.get('conv-xyz')?.agentSessionId).toBeNull()
    // Let the discovery microtask settle.
    await Promise.resolve()
    await Promise.resolve()
    expect(discoverCalls).toBe(1)
    expect(conversations.get('conv-xyz')?.agentSessionId).toBe('discovered-codex-id')
  })

  it('codex: leaves agentSessionId null when discovery finds nothing', async () => {
    dir = mkdtempSync(join(tmpdir(), 'persist-'))
    n = 0
    const { projects, conversations } = stores(dir, now, newId)
    const p = createSessionPersistence({ projects, conversations, discover: async () => null })
    p.onAgentSpawn({ conversationId: 'c1', tool: 'codex', cwd: '/x', title: 't' })
    await Promise.resolve()
    await Promise.resolve()
    expect(conversations.get('c1')?.agentSessionId).toBeNull()
  })

  it('codex: a discovery rejection is swallowed and never throws', async () => {
    dir = mkdtempSync(join(tmpdir(), 'persist-'))
    n = 0
    const { projects, conversations } = stores(dir, now, newId)
    const p = createSessionPersistence({ projects, conversations, discover: async () => { throw new Error('boom') } })
    expect(() => p.onAgentSpawn({ conversationId: 'c2', tool: 'codex', cwd: '/x', title: 't' })).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
    expect(conversations.get('c2')?.agentSessionId).toBeNull()
  })

  it('re-launching into the same folder reuses the one project', () => {
    dir = mkdtempSync(join(tmpdir(), 'persist-'))
    n = 0
    const { projects, conversations } = stores(dir, now, newId)
    const p = createSessionPersistence({ projects, conversations, discover: async () => null })
    p.onAgentSpawn({ conversationId: 'a', tool: 'claude', cwd: '/repo', title: 't', preAssignedSessionId: 'a' })
    p.onAgentSpawn({ conversationId: 'b', tool: 'claude', cwd: '/repo', title: 't2', preAssignedSessionId: 'b' })
    expect(projects.list()).toHaveLength(1)
    expect(conversations.byProject(projects.list()[0].id)).toHaveLength(2)
  })
})

describe('session persistence: archive with live-tab exemption', () => {
  let dir: string
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('archives an idle project but exempts one with a live tab', () => {
    dir = mkdtempSync(join(tmpdir(), 'persist-'))
    const DAY = 86_400_000
    let clock = 1_000_000_000_000
    let m = 0
    const projects = createProjectsStore({ file: join(dir, 'projects.json'), now: () => clock, newId: () => `p-${++m}` })
    const conversations = createConversationsStore({ file: join(dir, 'conversations.json'), now: () => clock })
    const p = createSessionPersistence({ projects, conversations, now: () => clock, discover: async () => null })

    // Two projects launched now; one keeps a live tab, the other's tab exits.
    p.onAgentSpawn({ conversationId: 'ca', tool: 'claude', cwd: '/live', title: 't', ptyId: 'pty-a', preAssignedSessionId: 'ca' })
    p.onAgentSpawn({ conversationId: 'cb', tool: 'claude', cwd: '/idle', title: 't', ptyId: 'pty-b', preAssignedSessionId: 'cb' })
    p.onTabExit('pty-b') // /idle is no longer live

    const liveId = projects.list().find((x) => x.path === '/live')!.id
    const idleId = projects.list().find((x) => x.path === '/idle')!.id

    // 20 days later, both are idle by lastActiveAt, but /live still has a tab.
    clock += 20 * DAY
    const archived = p.runArchive(14)

    expect(archived).toEqual([idleId])
    expect(projects.get(liveId)?.archivedAt).toBeNull()
    expect(projects.get(idleId)?.archivedAt).not.toBeNull()
  })

  it('runArchive with 0 days is a no-op', () => {
    dir = mkdtempSync(join(tmpdir(), 'persist-'))
    let m = 0
    const projects = createProjectsStore({ file: join(dir, 'projects.json'), now: () => 1000, newId: () => `p-${++m}` })
    const conversations = createConversationsStore({ file: join(dir, 'conversations.json'), now: () => 1000 })
    const p = createSessionPersistence({ projects, conversations, now: () => 5_000_000_000_000, discover: async () => null })
    p.onAgentSpawn({ conversationId: 'c', tool: 'claude', cwd: '/x', title: 't', ptyId: 'pty', preAssignedSessionId: 'c' })
    p.onTabExit('pty')
    expect(p.runArchive(0)).toEqual([])
  })
})
