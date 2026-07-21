import { describe, it, expect } from 'vitest'
import { clipboardAction, type KeyLike } from './terminal-clipboard'

function key(k: string, mods: Partial<KeyLike> = {}): KeyLike {
  return { key: k, ctrlKey: false, metaKey: false, shiftKey: false, ...mods }
}

describe('clipboardAction', () => {
  it('Ctrl+C with a selection copies', () => {
    expect(clipboardAction(key('c', { ctrlKey: true }), true)).toBe('copy')
  })

  it('Ctrl+C with no selection passes through (SIGINT preserved)', () => {
    expect(clipboardAction(key('c', { ctrlKey: true }), false)).toBe('passthrough')
  })

  it('Ctrl+V always pastes', () => {
    expect(clipboardAction(key('v', { ctrlKey: true }), false)).toBe('paste')
  })

  it('Ctrl+Shift+C with a selection copies', () => {
    expect(clipboardAction(key('c', { ctrlKey: true, shiftKey: true }), true)).toBe('copy')
  })

  it('Ctrl+Shift+V pastes', () => {
    expect(clipboardAction(key('v', { ctrlKey: true, shiftKey: true }), false)).toBe('paste')
  })

  it('Cmd+C / Cmd+V (mac) behave like the Ctrl variants', () => {
    expect(clipboardAction(key('c', { metaKey: true }), true)).toBe('copy')
    expect(clipboardAction(key('v', { metaKey: true }), false)).toBe('paste')
  })

  it('handles uppercase key values (Shift reports "C"/"V")', () => {
    expect(clipboardAction(key('C', { ctrlKey: true, shiftKey: true }), true)).toBe('copy')
    expect(clipboardAction(key('V', { ctrlKey: true, shiftKey: true }), false)).toBe('paste')
  })

  it('passes through plain keys and modifier-less C/V', () => {
    expect(clipboardAction(key('c'), true)).toBe('passthrough')
    expect(clipboardAction(key('v'), false)).toBe('passthrough')
    expect(clipboardAction(key('a', { ctrlKey: true }), true)).toBe('passthrough')
  })
})
