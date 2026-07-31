import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConversationsStore } from './conversations-store'

describe('conversations store', () => {
  let dir: string
  let file: string
  let clock: number
  const now = (): number => clock

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'conv-'))
    file = join(dir, 'conversations.json')
    clock = 1000
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('inserts a new conversation with a null agentSessionId by default', () => {
    const s = createConversationsStore({ file, now })
    const c = s.upsert({ id: 'c1', projectId: 'p1', title: 't', tool: 'codex', cwd: '/x' })
    expect(c).toMatchObject({ id: 'c1', projectId: 'p1', agentSessionId: null, createdAt: 1000, lastActiveAt: 1000 })
    expect(s.list()).toHaveLength(1)
  })

  it('captures agentSessionId at insert when provided (claude pre-assign)', () => {
    const s = createConversationsStore({ file, now })
    const c = s.upsert({ id: 'c1', projectId: 'p1', title: 't', tool: 'claude', cwd: '/x', agentSessionId: 'c1' })
    expect(c.agentSessionId).toBe('c1')
  })

  it('upsert patches an existing record and bumps lastActiveAt without touching createdAt', () => {
    const s = createConversationsStore({ file, now })
    s.upsert({ id: 'c1', projectId: 'p1', title: 'old', tool: 'codex', cwd: '/x' })
    clock = 2000
    const c = s.upsert({ id: 'c1', projectId: 'p1', title: 'new', tool: 'codex', cwd: '/x' })
    expect(s.list()).toHaveLength(1)
    expect(c.title).toBe('new')
    expect(c.createdAt).toBe(1000)
    expect(c.lastActiveAt).toBe(2000)
  })

  it('S7: defaults autoTitle to true on insert, and honors an explicit false', () => {
    const s = createConversationsStore({ file, now })
    expect(s.upsert({ id: 'a', projectId: 'p1', title: 't', tool: 'claude', cwd: '/x' }).autoTitle).toBe(true)
    expect(s.upsert({ id: 'b', projectId: 'p1', title: 'fix bug', tool: 'claude', cwd: '/x', autoTitle: false }).autoTitle).toBe(false)
  })

  it('S7: setTitle sets a real title and clears autoTitle; no-op for an unknown id', () => {
    const s = createConversationsStore({ file, now })
    s.upsert({ id: 'c1', projectId: 'p1', title: 'session · code', tool: 'claude', cwd: '/x' })
    s.setTitle('c1', 'fix the login bug')
    expect(s.get('c1')).toMatchObject({ title: 'fix the login bug', autoTitle: false })
    expect(() => s.setTitle('nope', 'x')).not.toThrow()
  })

  it('S7: a re-spawn does not clobber a meaningful (backfilled) title with a generic one', () => {
    const s = createConversationsStore({ file, now })
    s.upsert({ id: 'c1', projectId: 'p1', title: 'session · code', tool: 'claude', cwd: '/x' })
    s.setTitle('c1', 'add the widget') // now meaningful (autoTitle false)
    // A resume/re-spawn comes back through upsert with a generic title, no autoTitle.
    s.upsert({ id: 'c1', projectId: 'p1', title: 'session · code', tool: 'claude', cwd: '/x' })
    expect(s.get('c1')?.title).toBe('add the widget')
    // But an auto title still refreshes on re-spawn.
    s.upsert({ id: 'c2', projectId: 'p1', title: 'old', tool: 'claude', cwd: '/x' })
    s.upsert({ id: 'c2', projectId: 'p1', title: 'newer', tool: 'claude', cwd: '/x' })
    expect(s.get('c2')?.title).toBe('newer')
  })

  it('setAgentSessionId records the id, and is a no-op for an unknown conversation', () => {
    const s = createConversationsStore({ file, now })
    s.upsert({ id: 'c1', projectId: 'p1', title: 't', tool: 'codex', cwd: '/x' })
    s.setAgentSessionId('c1', 'codex-abc')
    expect(s.get('c1')?.agentSessionId).toBe('codex-abc')
    expect(() => s.setAgentSessionId('gone', 'x')).not.toThrow()
    expect(s.get('gone')).toBeUndefined()
  })

  it('lists by project', () => {
    const s = createConversationsStore({ file, now })
    s.upsert({ id: 'a', projectId: 'p1', title: 't', tool: 'claude', cwd: '/x' })
    s.upsert({ id: 'b', projectId: 'p2', title: 't', tool: 'claude', cwd: '/y' })
    s.upsert({ id: 'c', projectId: 'p1', title: 't', tool: 'claude', cwd: '/z' })
    expect(s.byProject('p1').map((c) => c.id).sort()).toEqual(['a', 'c'])
  })

  it('archive is reversible and never deletes', () => {
    const s = createConversationsStore({ file, now })
    s.upsert({ id: 'c1', projectId: 'p1', title: 't', tool: 'claude', cwd: '/x' })
    s.setArchived('c1', true)
    expect(s.get('c1')?.archivedAt).not.toBeNull()
    s.setArchived('c1', false)
    expect(s.get('c1')?.archivedAt).toBeNull()
    expect(s.list()).toHaveLength(1)
  })

  it('persists across instances and recovers empty from a corrupt file', () => {
    const s1 = createConversationsStore({ file, now })
    s1.upsert({ id: 'c1', projectId: 'p1', title: 't', tool: 'claude', cwd: '/x', agentSessionId: 'c1' })
    s1.flush()
    const s2 = createConversationsStore({ file, now })
    expect(s2.get('c1')?.agentSessionId).toBe('c1')

    writeFileSync(file, '{bad', 'utf8')
    const s3 = createConversationsStore({ file, now })
    expect(s3.list()).toEqual([])
  })
})
