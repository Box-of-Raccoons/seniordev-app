import { describe, expect, it } from 'vitest'
import { CodexJsonlParser } from './codex-jsonl'

const THREAD = '{"type":"thread.started","thread_id":"0199a213-81c0-7800-8aa1-bbab2a035a53"}'
const TURN = '{"type":"turn.started"}'
const CMD = '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"bash -lc ls","status":"in_progress"}}'
const CMD_DONE = '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"bash -lc ls","status":"completed"}}'
const MSG = '{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"Repo contains docs, sdk, and examples directories."}}'
const FAILED = '{"type":"turn.failed","error":{"message":"boom"}}'

describe('CodexJsonlParser', () => {
  it('emits session + log from thread.started', () => {
    const p = new CodexJsonlParser()
    expect(p.feed(THREAD + '\n')).toEqual([
      { kind: 'session', id: '0199a213-81c0-7800-8aa1-bbab2a035a53' },
      { kind: 'log', text: '▸ thread 0199a213-81c0-7800-8aa1-bbab2a035a53' }
    ])
  })
  it('logs command starts and agent messages, skips command completions and turn.started', () => {
    const p = new CodexJsonlParser()
    expect(p.feed([TURN, CMD, CMD_DONE, MSG].join('\n') + '\n')).toEqual([
      { kind: 'log', text: '▸ run bash -lc ls' },
      { kind: 'log', text: 'Repo contains docs, sdk, and examples directories.' }
    ])
  })
  it('surfaces turn.failed with its message', () => {
    const p = new CodexJsonlParser()
    expect(p.feed(FAILED + '\n')).toEqual([{ kind: 'log', text: '✘ turn failed: boom' }])
  })
  it('passes non-JSON lines through as raw log', () => {
    const p = new CodexJsonlParser()
    expect(p.feed('warning: something\n')).toEqual([{ kind: 'log', text: 'warning: something' }])
  })
  it('treats valid-JSON primitives and arrays as raw log, not events', () => {
    const p = new CodexJsonlParser()
    expect(p.feed('null\n[1,2,3]\n')).toEqual([
      { kind: 'log', text: 'null' },
      { kind: 'log', text: '[1,2,3]' }
    ])
  })
})
