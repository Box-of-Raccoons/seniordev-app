import { describe, expect, it } from 'vitest'
import { createParser } from './index'
import { ClaudeStreamJsonParser } from './claude-stream-json'
import { CodexJsonlParser } from './codex-jsonl'
import { TextParser } from './text'

describe('createParser', () => {
  it('maps each name to its parser', () => {
    expect(createParser('claude-stream-json')).toBeInstanceOf(ClaudeStreamJsonParser)
    expect(createParser('codex-jsonl')).toBeInstanceOf(CodexJsonlParser)
    expect(createParser('text')).toBeInstanceOf(TextParser)
  })
  it('threads sessionIdPattern into the text parser', () => {
    const p = createParser('text', 'id=(\\w+)')
    const ev = p.feed('id=abc\n')
    expect(ev).toContainEqual({ kind: 'session', id: 'abc' })
  })
})
