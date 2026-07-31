import { describe, it, expect } from 'vitest'
import { isSubagent, agentOf, sessionOf, parseClaudeAssistantLine } from '../../src/main/subagents/claude-watcher'

// The claude subagent watcher's live file-watch path is a thin, racconsole-proven
// chokidar adapter; a real-watch test proved flaky (temp-dir fsevents timing), so
// coverage lives on the deterministic pure functions the adapter delegates to:
// path parsing (session/agent from a transcript path) and per-line parsing
// (tool_use/text/thinking → activity payloads).

describe('claude path helpers', () => {
  it('isSubagent matches a subagents/agent-*.jsonl path and rejects others', () => {
    expect(isSubagent('/x/Proj/sess/subagents/agent-abc.jsonl')).toBe(true)
    expect(isSubagent('C:\\x\\Proj\\sess\\subagents\\agent-abc.jsonl')).toBe(true)
    expect(isSubagent('/x/Proj/sess/agent-abc.jsonl')).toBe(false) // not under subagents/
    expect(isSubagent('/x/Proj/sess/subagents/notes.txt')).toBe(false)
  })

  it('agentOf strips the leading agent- prefix and .jsonl suffix', () => {
    expect(agentOf('/x/subagents/agent-xyz789.jsonl')).toBe('xyz789')
    expect(agentOf('/x/subagents/agent-agent-nested.jsonl')).toBe('agent-nested') // only the leading prefix
  })

  it('sessionOf returns the dir immediately above subagents/', () => {
    expect(sessionOf('/x/Proj/sess-abc123/subagents/agent-xyz789.jsonl')).toBe('sess-abc123')
    expect(sessionOf('C:\\x\\Proj\\sess-abc123\\subagents\\agent-xyz789.jsonl')).toBe('sess-abc123')
    expect(sessionOf('/no/subagents/segment/here.jsonl')).toBe('no') // dir just above subagents/
  })

  it('sessionOf returns "?" when there is no subagents segment', () => {
    expect(sessionOf('/x/Proj/sess/agent.jsonl')).toBe('?')
  })
})

describe('parseClaudeAssistantLine', () => {
  it('emits a tool activity for a tool_use item with target from file_path', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/a/b.ts' } }] }
    })
    expect(parseClaudeAssistantLine(line)).toEqual([{ kind: 'tool', tool: 'Read', target: '/a/b.ts' }])
  })

  it('derives tool target from path, then pattern, then a truncated command', () => {
    const byPath = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Edit', input: { path: '/p' } }] }
    })
    expect(parseClaudeAssistantLine(byPath)[0].target).toBe('/p')

    const byPattern = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Grep', input: { pattern: 'foo' } }] }
    })
    expect(parseClaudeAssistantLine(byPattern)[0].target).toBe('foo')

    const longCmd = 'echo ' + 'x'.repeat(200)
    const byCmd = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: longCmd } }] }
    })
    const t = parseClaudeAssistantLine(byCmd)[0].target ?? ''
    expect(t.length).toBe(60) // racconsole slices command to 60 chars
    expect(t.startsWith('echo ')).toBe(true)
  })

  it('emits text and thinking activities (trimmed)', () => {
    const text = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: '  hello  ' }] }
    })
    expect(parseClaudeAssistantLine(text)).toEqual([{ kind: 'text', text: 'hello' }])

    const thinking = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'thinking', thinking: '  pondering  ' }] }
    })
    expect(parseClaudeAssistantLine(thinking)).toEqual([{ kind: 'thinking', text: 'pondering' }])
  })

  it('emits multiple activities from one line in order', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'first' },
          { type: 'tool_use', name: 'Read', input: { file_path: '/f' } }
        ]
      }
    })
    expect(parseClaudeAssistantLine(line)).toEqual([
      { kind: 'text', text: 'first' },
      { kind: 'tool', tool: 'Read', target: '/f' }
    ])
  })

  it('returns [] for non-assistant, malformed, empty-content, and empty-text lines', () => {
    expect(parseClaudeAssistantLine(JSON.stringify({ type: 'user', message: { content: [] } }))).toEqual([])
    expect(parseClaudeAssistantLine('{not json')).toEqual([])
    expect(parseClaudeAssistantLine(JSON.stringify({ type: 'assistant', message: { content: 'nope' } }))).toEqual([])
    expect(
      parseClaudeAssistantLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '   ' }] } }))
    ).toEqual([])
  })
})
