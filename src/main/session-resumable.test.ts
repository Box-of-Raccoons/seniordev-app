import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeHasTranscript, codexRolloutHasContent, isConversationResumable } from './session-resumable'

let dir: string
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('claudeHasTranscript', () => {
  it('true when a non-empty <id>.jsonl transcript exists in any project dir', () => {
    dir = mkdtempSync(join(tmpdir(), 'claude-'))
    const proj = join(dir, '-Users-h-code')
    mkdirSync(proj, { recursive: true })
    writeFileSync(join(proj, 'sess-1.jsonl'), '{"type":"user"}\n')
    expect(claudeHasTranscript('sess-1', dir)).toBe(true)
  })

  it('false when no transcript exists for the id (spawned, never typed into)', () => {
    dir = mkdtempSync(join(tmpdir(), 'claude-'))
    mkdirSync(join(dir, '-Users-h-code'), { recursive: true })
    // Only session-env exists elsewhere; no projects/<hash>/sess-2.jsonl.
    expect(claudeHasTranscript('sess-2', dir)).toBe(false)
  })

  it('false for an empty (zero-byte) transcript file', () => {
    dir = mkdtempSync(join(tmpdir(), 'claude-'))
    const proj = join(dir, '-p')
    mkdirSync(proj, { recursive: true })
    writeFileSync(join(proj, 'sess-3.jsonl'), '')
    expect(claudeHasTranscript('sess-3', dir)).toBe(false)
  })

  it('false when the projects dir is missing entirely', () => {
    expect(claudeHasTranscript('x', join(tmpdir(), 'does-not-exist-xyz'))).toBe(false)
  })
})

describe('codexRolloutHasContent', () => {
  function rollout(dirName: string, fileName: string, lines: object[]): void {
    const d = join(dir, dirName)
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, fileName), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  }

  it('true when the rollout for the id records a user_message turn', () => {
    dir = mkdtempSync(join(tmpdir(), 'codex-'))
    rollout('2026/07/30', 'rollout-2026-07-30T08-00-00-abc-111.jsonl', [
      { type: 'session_meta', payload: { cwd: '/x' } },
      { type: 'event_msg', payload: { type: 'user_message' } },
      { type: 'event_msg', payload: { type: 'agent_message' } }
    ])
    expect(codexRolloutHasContent('abc-111', dir)).toBe(true)
  })

  it('false when the rollout exists but has no user turn (spawned, nothing typed)', () => {
    dir = mkdtempSync(join(tmpdir(), 'codex-'))
    rollout('2026/07/30', 'rollout-2026-07-30T08-00-00-abc-222.jsonl', [
      { type: 'session_meta', payload: { cwd: '/x' } },
      { type: 'event_msg', payload: { type: 'task_started' } }
    ])
    expect(codexRolloutHasContent('abc-222', dir)).toBe(false)
  })

  it('false when no rollout exists for the id', () => {
    dir = mkdtempSync(join(tmpdir(), 'codex-'))
    rollout('2026/07/30', 'rollout-2026-07-30T08-00-00-other.jsonl', [{ type: 'session_meta' }])
    expect(codexRolloutHasContent('missing-id', dir)).toBe(false)
  })
})

describe('isConversationResumable', () => {
  it('false immediately when agentSessionId is null (no id to resume)', () => {
    expect(isConversationResumable({ tool: 'claude', agentSessionId: null })).toBe(false)
    expect(isConversationResumable({ tool: 'codex', agentSessionId: null })).toBe(false)
  })

  it('claude: gated on the transcript existing (the regression case)', () => {
    dir = mkdtempSync(join(tmpdir(), 'claude-'))
    const proj = join(dir, '-p')
    mkdirSync(proj, { recursive: true })
    writeFileSync(join(proj, 'real.jsonl'), '{"t":1}\n')
    expect(isConversationResumable({ tool: 'claude', agentSessionId: 'real' }, { claudeProjectsDir: dir })).toBe(true)
    // An id with no transcript — spawned but never used — is NOT resumable.
    expect(isConversationResumable({ tool: 'claude', agentSessionId: 'empty' }, { claudeProjectsDir: dir })).toBe(false)
  })

  it('an unmodelled tool trusts its stored id', () => {
    expect(isConversationResumable({ tool: 'someother', agentSessionId: 'z' })).toBe(true)
  })
})
