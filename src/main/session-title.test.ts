import { describe, it, expect } from 'vitest'
import { parseClaudeFirstUserText, parseCodexFirstUserText, summarizeTitle } from './session-title'

describe('summarizeTitle', () => {
  it('takes the first non-empty line, collapses whitespace', () => {
    expect(summarizeTitle('  fix   the   login \n more')).toBe('fix the login')
  })
  it('truncates long text with an ellipsis', () => {
    const out = summarizeTitle('a'.repeat(80), 10)
    expect(out.length).toBeLessThanOrEqual(10)
    expect(out.endsWith('…')).toBe(true)
  })
  it('skips leading blank lines', () => {
    expect(summarizeTitle('\n\n  real title\nrest')).toBe('real title')
  })
})

describe('parseClaudeFirstUserText', () => {
  it('returns the first non-meta user message (string content)', () => {
    const jsonl = [
      JSON.stringify({ type: 'user', isMeta: true, message: { content: '<local-command-caveat>skip me' } }),
      JSON.stringify({ type: 'user', message: { content: '<command-name>/clear' } }),
      JSON.stringify({ type: 'assistant', message: { content: 'hi' } }),
      JSON.stringify({ type: 'user', message: { content: 'Start the widget work' } })
    ].join('\n')
    expect(parseClaudeFirstUserText(jsonl)).toBe('Start the widget work')
  })

  it('joins text blocks when content is an array', () => {
    const jsonl = JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'text', text: 'fix the' }, { type: 'image' }, { type: 'text', text: 'login bug' }] }
    })
    expect(parseClaudeFirstUserText(jsonl)).toBe('fix the login bug')
  })

  it('returns null when there is no usable user message', () => {
    expect(parseClaudeFirstUserText('')).toBeNull()
    expect(parseClaudeFirstUserText(JSON.stringify({ type: 'assistant', message: { content: 'x' } }))).toBeNull()
    expect(parseClaudeFirstUserText('not json\n{bad')).toBeNull()
  })
})

describe('parseCodexFirstUserText', () => {
  it('returns the first user_message payload text', () => {
    const jsonl = [
      JSON.stringify({ type: 'session_meta', payload: { cwd: '/x' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'thinking' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: "say 'bonjour'" } })
    ].join('\n')
    expect(parseCodexFirstUserText(jsonl)).toBe("say 'bonjour'")
  })

  it('returns null when there is no user_message', () => {
    expect(parseCodexFirstUserText(JSON.stringify({ payload: { type: 'session_meta' } }))).toBeNull()
    expect(parseCodexFirstUserText('')).toBeNull()
  })
})
