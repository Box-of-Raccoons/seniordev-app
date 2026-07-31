import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
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

// S4: the sidebar re-fetches on onChange, so it must fire exactly at the moments
// the stored set changes — a spawn, a codex id resolving, and an actual archival.
describe('session persistence: onChange sidebar nudge', () => {
  let dir: string
  const now = (): number => 1000
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('fires once on a claude spawn (record created)', () => {
    dir = mkdtempSync(join(tmpdir(), 'persist-'))
    let m = 0
    const { projects, conversations } = stores(dir, now, () => `p-${++m}`)
    let changes = 0
    const p = createSessionPersistence({ projects, conversations, discover: async () => null, onChange: () => (changes += 1) })
    p.onAgentSpawn({ conversationId: 'c', tool: 'claude', cwd: '/x', title: 't', preAssignedSessionId: 'c' })
    expect(changes).toBe(1)
  })

  it('fires again when codex discovery resolves an id', async () => {
    dir = mkdtempSync(join(tmpdir(), 'persist-'))
    let m = 0
    const { projects, conversations } = stores(dir, now, () => `p-${++m}`)
    let changes = 0
    const p = createSessionPersistence({ projects, conversations, discover: async () => 'codex-id', onChange: () => (changes += 1) })
    p.onAgentSpawn({ conversationId: 'c', tool: 'codex', cwd: '/x', title: 't' })
    expect(changes).toBe(1) // spawn
    await Promise.resolve()
    await Promise.resolve()
    expect(changes).toBe(2) // discovery resolved
  })

  it('does not fire on a discovery miss (agentSessionId stays null)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'persist-'))
    let m = 0
    const { projects, conversations } = stores(dir, now, () => `p-${++m}`)
    let changes = 0
    const p = createSessionPersistence({ projects, conversations, discover: async () => null, onChange: () => (changes += 1) })
    p.onAgentSpawn({ conversationId: 'c', tool: 'codex', cwd: '/x', title: 't' })
    await Promise.resolve()
    await Promise.resolve()
    expect(changes).toBe(1) // only the spawn, no id to fill
  })

  it('fires on an actual archival, not on a 0-day no-op', () => {
    dir = mkdtempSync(join(tmpdir(), 'persist-'))
    const DAY = 86_400_000
    let clock = 1_000_000_000_000
    let m = 0
    const projects = createProjectsStore({ file: join(dir, 'projects.json'), now: () => clock, newId: () => `p-${++m}` })
    const conversations = createConversationsStore({ file: join(dir, 'conversations.json'), now: () => clock })
    let changes = 0
    const p = createSessionPersistence({ projects, conversations, now: () => clock, discover: async () => null, onChange: () => (changes += 1) })
    p.onAgentSpawn({ conversationId: 'c', tool: 'claude', cwd: '/idle', title: 't', ptyId: 'pty', preAssignedSessionId: 'c' })
    p.onTabExit('pty')
    changes = 0 // reset after the spawn's nudge
    expect(p.runArchive(0)).toEqual([]) // disabled → no change
    expect(changes).toBe(0)
    clock += 20 * DAY
    expect(p.runArchive(14)).toHaveLength(1) // archived → one nudge
    expect(changes).toBe(1)
  })

  it('fires on tab exit (a finished session may now be resumable)', () => {
    dir = mkdtempSync(join(tmpdir(), 'persist-'))
    let m = 0
    const { projects, conversations } = stores(dir, now, () => `p-${++m}`)
    let changes = 0
    const p = createSessionPersistence({ projects, conversations, discover: async () => null, onChange: () => (changes += 1) })
    p.onAgentSpawn({ conversationId: 'c', tool: 'claude', cwd: '/x', title: 't', ptyId: 'pty', preAssignedSessionId: 'c' })
    changes = 0 // reset after the spawn nudge
    p.onTabExit('pty')
    expect(changes).toBe(1)
  })

  it('a throwing onChange never breaks persistence', () => {
    dir = mkdtempSync(join(tmpdir(), 'persist-'))
    let m = 0
    const { projects, conversations } = stores(dir, now, () => `p-${++m}`)
    const p = createSessionPersistence({
      projects,
      conversations,
      discover: async () => null,
      onChange: () => {
        throw new Error('sender gone')
      }
    })
    expect(() => p.onAgentSpawn({ conversationId: 'c', tool: 'claude', cwd: '/x', title: 't', preAssignedSessionId: 'c' })).not.toThrow()
    expect(conversations.get('c')?.agentSessionId).toBe('c')
  })
})

// The live poll can miss a codex id (its 20s window loses the race); the rollout
// persists on disk, so backfill re-discovers it. A real UUIDv7 whose embedded time
// is known lets us place the conversation's createdAt inside the backfill window.
describe('session persistence: codex backfill', () => {
  let dir: string
  const CODEX_UUID = '019fb310-96b4-7920-ab44-2e7f14960f8c' // decodes to 1785415636660 ms
  const NEAR = 1785415635466 // ~1.2s before the id time → inside the backfill window
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  function withRollout(cwd: string, hasUserTurn = true): { sessionsDir: string } {
    const sessionsDir = join(dir, 'sessions')
    const day = join(sessionsDir, '2026', '07', '30')
    mkdirSync(day, { recursive: true })
    const lines = [JSON.stringify({ type: 'session_meta', payload: { cwd } })]
    if (hasUserTurn) lines.push(JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } }))
    writeFileSync(join(day, `rollout-2026-07-30T08-47-16-${CODEX_UUID}.jsonl`), lines.join('\n') + '\n')
    return { sessionsDir }
  }

  it('fills a null codex id from a matching on-disk rollout, and nudges the sidebar', () => {
    dir = mkdtempSync(join(tmpdir(), 'persist-'))
    const { sessionsDir } = withRollout('/repo')
    const projects = createProjectsStore({ file: join(dir, 'projects.json'), now: () => NEAR, newId: () => 'proj' })
    const conversations = createConversationsStore({ file: join(dir, 'conversations.json'), now: () => NEAR })
    let changes = 0
    const p = createSessionPersistence({ projects, conversations, sessionsDir, discover: async () => null, onChange: () => (changes += 1) })
    conversations.upsert({ id: 'cx', projectId: 'proj', title: 't', tool: 'codex', cwd: '/repo', agentSessionId: null })
    changes = 0
    expect(p.backfillCodexSessions()).toBe(1)
    expect(conversations.get('cx')?.agentSessionId).toBe(CODEX_UUID)
    expect(changes).toBe(1)
  })

  it('leaves the id null when no rollout matches, and does not nudge', () => {
    dir = mkdtempSync(join(tmpdir(), 'persist-'))
    const { sessionsDir } = withRollout('/other-cwd') // rollout cwd mismatches
    const projects = createProjectsStore({ file: join(dir, 'projects.json'), now: () => NEAR, newId: () => 'proj' })
    const conversations = createConversationsStore({ file: join(dir, 'conversations.json'), now: () => NEAR })
    let changes = 0
    const p = createSessionPersistence({ projects, conversations, sessionsDir, discover: async () => null, onChange: () => (changes += 1) })
    conversations.upsert({ id: 'cx', projectId: 'proj', title: 't', tool: 'codex', cwd: '/repo', agentSessionId: null })
    changes = 0
    expect(p.backfillCodexSessions()).toBe(0)
    expect(conversations.get('cx')?.agentSessionId).toBeNull()
    expect(changes).toBe(0)
  })

  it('skips codex conversations that already have an id, and non-codex tools', () => {
    dir = mkdtempSync(join(tmpdir(), 'persist-'))
    const { sessionsDir } = withRollout('/repo')
    const projects = createProjectsStore({ file: join(dir, 'projects.json'), now: () => NEAR, newId: () => 'proj' })
    const conversations = createConversationsStore({ file: join(dir, 'conversations.json'), now: () => NEAR })
    const p = createSessionPersistence({ projects, conversations, sessionsDir, discover: async () => null })
    conversations.upsert({ id: 'has-id', projectId: 'proj', title: 't', tool: 'codex', cwd: '/repo', agentSessionId: 'kept' })
    conversations.upsert({ id: 'claude-c', projectId: 'proj', title: 't', tool: 'claude', cwd: '/repo', agentSessionId: null })
    expect(p.backfillCodexSessions()).toBe(0)
    expect(conversations.get('has-id')?.agentSessionId).toBe('kept')
    expect(conversations.get('claude-c')?.agentSessionId).toBeNull()
  })
})

describe('session persistence: S5 worktree threading', () => {
  let dir: string
  const now = (): number => 1000
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('records worktreePath/branch on the conversation and remembers worktreeDefault on the project', () => {
    dir = mkdtempSync(join(tmpdir(), 'persist-'))
    let m = 0
    const { projects, conversations } = stores(dir, now, () => `proj-${++m}`)
    const p = createSessionPersistence({ projects, conversations, discover: async () => null })
    p.onAgentSpawn({
      conversationId: 'c1',
      tool: 'claude',
      cwd: '/repo',
      title: 't',
      preAssignedSessionId: 'c1',
      worktreePath: '/cfg/worktrees/repo/feat',
      branch: 'feat',
      worktreeDefault: true
    })
    expect(conversations.get('c1')).toMatchObject({ worktreePath: '/cfg/worktrees/repo/feat', branch: 'feat' })
    expect(projects.list()[0].worktreeDefault).toBe(true)
  })

  it('a resume (no worktree fields) does NOT wipe a recorded worktreePath/branch', () => {
    dir = mkdtempSync(join(tmpdir(), 'persist-'))
    let m = 0
    const { projects, conversations } = stores(dir, now, () => `proj-${++m}`)
    const p = createSessionPersistence({ projects, conversations, discover: async () => null })
    p.onAgentSpawn({ conversationId: 'c1', tool: 'claude', cwd: '/repo', title: 't', preAssignedSessionId: 'c1', worktreePath: '/wt/x', branch: 'x', worktreeDefault: true })
    // Re-spawn the SAME conversation with no worktree fields (a sidebar resume).
    p.onAgentSpawn({ conversationId: 'c1', tool: 'claude', cwd: '/repo', title: 't', preAssignedSessionId: 'c1' })
    expect(conversations.get('c1')).toMatchObject({ worktreePath: '/wt/x', branch: 'x' })
  })

  it('a launch without worktreeDefault leaves a project\'s remembered choice untouched', () => {
    dir = mkdtempSync(join(tmpdir(), 'persist-'))
    let m = 0
    const { projects, conversations } = stores(dir, now, () => `proj-${++m}`)
    const p = createSessionPersistence({ projects, conversations, discover: async () => null })
    // First launch remembers "true".
    p.onAgentSpawn({ conversationId: 'c1', tool: 'claude', cwd: '/repo', title: 't', preAssignedSessionId: 'c1', worktreeDefault: true })
    // A later Open-mode / terminal launch carries no worktreeDefault → must not reset it.
    p.onAgentSpawn({ conversationId: 'c2', tool: 'claude', cwd: '/repo', title: 't2', preAssignedSessionId: 'c2' })
    expect(projects.list()[0].worktreeDefault).toBe(true)
  })
})

describe('session persistence: S7 title backfill', () => {
  let dir: string
  const now = (): number => 1000
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('sets autoTitle from hadPrompt at spawn (bare = true, prompted = false)', () => {
    dir = mkdtempSync(join(tmpdir(), 'persist-'))
    let m = 0
    const { projects, conversations } = stores(dir, now, () => `proj-${++m}`)
    const p = createSessionPersistence({ projects, conversations, discover: async () => null })
    p.onAgentSpawn({ conversationId: 'bare', tool: 'claude', cwd: '/x', title: 'session · x', preAssignedSessionId: 'bare', hadPrompt: false })
    p.onAgentSpawn({ conversationId: 'task', tool: 'claude', cwd: '/x', title: 'fix bug', preAssignedSessionId: 'task', hadPrompt: true })
    expect(conversations.get('bare')?.autoTitle).toBe(true)
    expect(conversations.get('task')?.autoTitle).toBe(false)
  })

  it('backfillTitles retitles only auto-titled conversations and clears the flag', () => {
    dir = mkdtempSync(join(tmpdir(), 'persist-'))
    const { projects, conversations } = stores(dir, now, () => 'proj')
    // readTitle resolves a title only for the auto-titled one.
    const p = createSessionPersistence({
      projects,
      conversations,
      discover: async () => null,
      readTitle: (c) => (c.agentSessionId === 'auto' ? 'fix the login bug' : null)
    })
    conversations.upsert({ id: 'auto', projectId: 'proj', title: 'session · x', tool: 'claude', cwd: '/x', agentSessionId: 'auto', autoTitle: true })
    conversations.upsert({ id: 'kept', projectId: 'proj', title: 'my own title', tool: 'claude', cwd: '/x', agentSessionId: 'kept', autoTitle: false })
    expect(p.backfillTitles()).toBe(1)
    expect(conversations.get('auto')).toMatchObject({ title: 'fix the login bug', autoTitle: false })
    expect(conversations.get('kept')?.title).toBe('my own title') // untouched
    // Idempotent: a second run finds nothing new.
    expect(p.backfillTitles()).toBe(0)
  })

  it('live poll backfills the title of a just-spawned bare conversation', async () => {
    dir = mkdtempSync(join(tmpdir(), 'persist-'))
    const { projects, conversations } = stores(dir, now, () => 'proj')
    const p = createSessionPersistence({
      projects,
      conversations,
      discover: async () => null,
      pollTitle: async () => 'typed the first message'
    })
    p.onAgentSpawn({ conversationId: 'c1', tool: 'claude', cwd: '/x', title: 'session · x', preAssignedSessionId: 'c1', hadPrompt: false })
    await new Promise((r) => setTimeout(r, 0)) // let the poll .then settle
    expect(conversations.get('c1')).toMatchObject({ title: 'typed the first message', autoTitle: false })
  })

  it('live poll does not clobber a prompted (non-auto) launch', async () => {
    dir = mkdtempSync(join(tmpdir(), 'persist-'))
    const { projects, conversations } = stores(dir, now, () => 'proj')
    const pollTitle = vi.fn(async () => 'should not be used')
    const p = createSessionPersistence({ projects, conversations, discover: async () => null, pollTitle })
    p.onAgentSpawn({ conversationId: 'c1', tool: 'claude', cwd: '/x', title: 'fix bug', preAssignedSessionId: 'c1', hadPrompt: true })
    await new Promise((r) => setTimeout(r, 0))
    expect(pollTitle).not.toHaveBeenCalled()
    expect(conversations.get('c1')?.title).toBe('fix bug')
  })
})
