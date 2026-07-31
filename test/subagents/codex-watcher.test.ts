import { describe, it, expect } from 'vitest'
import { isRollout, codexIdOf, parseCodexLine } from '../../src/main/subagents/codex-watcher'

// As with the claude watcher, the live rollout-tail path is a thin chokidar
// adapter (a real-watch test proved flaky on temp-dir fsevents timing); coverage
// lives on the deterministic pure functions: rollout-path parsing and per-line
// parsing (function_call/apply_patch/agent_message/message → activity, and
// task_complete → done).

const ID = '019fac38-7f16-7f90-b118-c9ba0cef3d8d'
const ROLLOUT_NAME = `rollout-2026-07-29T00-53-31-${ID}.jsonl`

describe('codex path helpers', () => {
  it('isRollout matches rollout-*.jsonl names', () => {
    expect(isRollout(ROLLOUT_NAME)).toBe(true)
    expect(isRollout('rollout-2026.jsonl')).toBe(true)
    expect(isRollout('notes.txt')).toBe(false)
    expect(isRollout('session.jsonl')).toBe(false)
  })

  it('codexIdOf extracts the trailing UUID from a rollout path', () => {
    expect(codexIdOf(`/x/2026/07/29/${ROLLOUT_NAME}`)).toBe(ID)
  })

  it('codexIdOf falls back to the basename sans .jsonl when no UUID present', () => {
    expect(codexIdOf('/x/rollout-weird.jsonl')).toBe('rollout-weird')
  })
})

describe('parseCodexLine', () => {
  it('maps a function_call to a tool activity with a truncated command target', () => {
    const line = JSON.stringify({ payload: { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: 'ls -la' }) } })
    expect(parseCodexLine(line)).toEqual({ kind: 'tool', tool: 'shell', target: 'ls -la' })
  })

  it('names the tool "call" when function_call has no name; truncates command to 60', () => {
    const longCmd = 'echo ' + 'y'.repeat(200)
    const line = JSON.stringify({ payload: { type: 'function_call', arguments: JSON.stringify({ command: longCmd }) } })
    const ev = parseCodexLine(line)
    expect(ev).not.toBeNull()
    if (ev && ev.kind === 'tool') {
      expect(ev.tool).toBe('call')
      expect((ev.target ?? '').length).toBe(60)
    }
  })

  it('maps a custom_tool_call apply_patch to a tool activity with the patched file target', () => {
    const line = JSON.stringify({
      payload: { type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch\n*** Update File: src/x.ts\n' }
    })
    expect(parseCodexLine(line)).toEqual({ kind: 'tool', tool: 'apply_patch', target: 'src/x.ts' })
  })

  it('returns null for a non-apply_patch custom_tool_call', () => {
    expect(parseCodexLine(JSON.stringify({ payload: { type: 'custom_tool_call', name: 'other' } }))).toBeNull()
  })

  it('maps an agent_message to a trimmed text activity', () => {
    expect(parseCodexLine(JSON.stringify({ payload: { type: 'agent_message', message: '  hi there  ' } }))).toEqual({
      kind: 'text',
      text: 'hi there'
    })
  })

  it('maps an assistant message with output_text content to a text activity', () => {
    const line = JSON.stringify({
      payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done thinking' }] }
    })
    expect(parseCodexLine(line)).toEqual({ kind: 'text', text: 'done thinking' })
  })

  it('maps task_complete to a done marker', () => {
    expect(parseCodexLine(JSON.stringify({ payload: { type: 'task_complete' } }))).toEqual({ kind: 'done' })
  })

  it('reads payload-less lines at the top level (payload ?? obj)', () => {
    // racconsole: const pl = obj.payload ?? obj
    expect(parseCodexLine(JSON.stringify({ type: 'task_complete' }))).toEqual({ kind: 'done' })
  })

  it('returns null for unknown types and malformed json', () => {
    expect(parseCodexLine(JSON.stringify({ payload: { type: 'whatever' } }))).toBeNull()
    expect(parseCodexLine('{not json')).toBeNull()
  })
})
