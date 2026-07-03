import { describe, expect, it } from 'vitest'
import { ClaudeStreamJsonParser } from './claude-stream-json'

const INIT = '{"type":"system","subtype":"init","cwd":"C:\\\\repo","session_id":"1941ebac-946a-4036-982b-0a504eee8f0d","tools":[],"model":"claude-fable-5"}'
const HOOK = '{"type":"system","subtype":"hook_started","hook_id":"h1","hook_name":"SessionStart:startup","session_id":"1941ebac"}'
const RATE = '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"},"session_id":"1941ebac"}'
const TEXT = '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Opening a PR now."}]},"session_id":"1941ebac"}'
const THINK = '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"hmm"}]},"session_id":"1941ebac"}'
const TOOL = '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu1","name":"Edit","input":{"file_path":"src/foo.ts","old_string":"a"}}]},"session_id":"1941ebac"}'
const RESULT = '{"type":"result","subtype":"success","is_error":false,"result":"done","session_id":"1941ebac"}'

describe('ClaudeStreamJsonParser', () => {
  it('emits session + log from init', () => {
    const p = new ClaudeStreamJsonParser()
    expect(p.feed(INIT + '\n')).toEqual([
      { kind: 'session', id: '1941ebac-946a-4036-982b-0a504eee8f0d' },
      { kind: 'log', text: '▸ session 1941ebac-946a-4036-982b-0a504eee8f0d' }
    ])
  })
  it('renders assistant text verbatim and tool_use as a one-liner', () => {
    const p = new ClaudeStreamJsonParser()
    expect(p.feed(TEXT + '\n' + TOOL + '\n')).toEqual([
      { kind: 'log', text: 'Opening a PR now.' },
      { kind: 'log', text: '▸ Edit src/foo.ts' }
    ])
  })
  it('skips hook noise, rate limits, and thinking blocks', () => {
    const p = new ClaudeStreamJsonParser()
    expect(p.feed(HOOK + '\n' + RATE + '\n' + THINK + '\n')).toEqual([])
  })
  it('summarizes the result event as a status line', () => {
    const p = new ClaudeStreamJsonParser()
    expect(p.feed(RESULT + '\n')).toEqual([{ kind: 'log', text: '✔ run finished' }])
    const p2 = new ClaudeStreamJsonParser()
    expect(p2.feed('{"type":"result","subtype":"error","is_error":true}\n')).toEqual([
      { kind: 'log', text: '✘ run failed' }
    ])
  })
  it('passes non-JSON lines through as raw log', () => {
    const p = new ClaudeStreamJsonParser()
    expect(p.feed('plain noise\n')).toEqual([{ kind: 'log', text: 'plain noise' }])
  })
  it('survives a JSON line split across chunks', () => {
    const p = new ClaudeStreamJsonParser()
    const half = TEXT.slice(0, 40)
    expect(p.feed(half)).toEqual([])
    expect(p.feed(TEXT.slice(40) + '\n')).toEqual([{ kind: 'log', text: 'Opening a PR now.' }])
  })
  it('treats valid-JSON primitives and arrays as raw log, not events', () => {
    const p = new ClaudeStreamJsonParser()
    expect(p.feed('null\n[1,2,3]\n"str"\n')).toEqual([
      { kind: 'log', text: 'null' },
      { kind: 'log', text: '[1,2,3]' },
      { kind: 'log', text: '"str"' }
    ])
  })
})
