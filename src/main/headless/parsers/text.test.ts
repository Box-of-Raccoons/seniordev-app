import { describe, expect, it } from 'vitest'
import { TextParser } from './text'

describe('TextParser', () => {
  it('passes every line through as log', () => {
    const p = new TextParser()
    expect(p.feed('hello\nworld\n')).toEqual([
      { kind: 'log', text: 'hello' },
      { kind: 'log', text: 'world' }
    ])
  })
  it('emits session once from sessionIdPattern (capture group preferred)', () => {
    const p = new TextParser('session id: ([0-9a-f-]+)')
    const ev = p.feed('session id: abc-123\nsession id: def-456\n')
    expect(ev.filter((e) => e.kind === 'session')).toEqual([{ kind: 'session', id: 'abc-123' }])
    // The matching line must still pass through as log — the runner shows every line.
    expect(ev.filter((e) => e.kind === 'log')).toEqual([
      { kind: 'log', text: 'session id: abc-123' },
      { kind: 'log', text: 'session id: def-456' }
    ])
  })
  it('ignores an invalid pattern instead of throwing', () => {
    const p = new TextParser('([bad')
    expect(p.feed('x\n')).toEqual([{ kind: 'log', text: 'x' }])
  })
  it('flush drains the partial tail', () => {
    const p = new TextParser()
    p.feed('no-newline')
    expect(p.flush()).toEqual([{ kind: 'log', text: 'no-newline' }])
  })
})
