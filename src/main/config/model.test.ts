import { describe, expect, it } from 'vitest'
import { resolveModelArgs } from './model'
import { CLI_PRESETS } from './presets'

describe('resolveModelArgs', () => {
  it('substitutes the resolved model into the claude/codex preset modelArgs', () => {
    expect(resolveModelArgs(CLI_PRESETS.claude, 'claude-opus')).toEqual(['--model', 'claude-opus'])
    expect(resolveModelArgs(CLI_PRESETS.codex, 'gpt-5')).toEqual(['--model', 'gpt-5'])
  })

  it('prefers the prompt model over the tool defaultModel (resolution order)', () => {
    const tool = { modelArgs: ['--model', '{{model}}'], defaultModel: 'fallback' }
    expect(resolveModelArgs(tool, 'chosen')).toEqual(['--model', 'chosen'])
  })

  it('falls back to the tool defaultModel when the prompt has none', () => {
    const tool = { modelArgs: ['--model', '{{model}}'], defaultModel: 'fallback' }
    expect(resolveModelArgs(tool, undefined)).toEqual(['--model', 'fallback'])
  })

  it('appends nothing when neither a prompt model nor a defaultModel is set', () => {
    expect(resolveModelArgs({ modelArgs: ['--model', '{{model}}'] }, undefined)).toEqual([])
  })

  it('appends nothing when the tool cannot express a model (no modelArgs)', () => {
    expect(resolveModelArgs({ modelArgs: [], defaultModel: 'big' }, 'opus')).toEqual([])
    expect(resolveModelArgs({}, 'opus')).toEqual([])
  })

  it('treats an empty/whitespace model as absent', () => {
    const tool = { modelArgs: ['--model', '{{model}}'], defaultModel: '' }
    expect(resolveModelArgs(tool, '   ')).toEqual([])
  })

  it('does not mangle a model id containing $-sequences', () => {
    expect(resolveModelArgs({ modelArgs: ['--model', '{{model}}'] }, 'a$&b')).toEqual(['--model', 'a$&b'])
  })
})
