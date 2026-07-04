import { describe, expect, it } from 'vitest'
import { normalizePromptModel, pickPromptModel, resolveModelArgs } from './model'
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

describe('normalizePromptModel', () => {
  it('keeps a plain string', () => {
    expect(normalizePromptModel('claude-opus')).toBe('claude-opus')
  })

  it('keeps a per-tool map of string values', () => {
    expect(normalizePromptModel({ claude: 'claude-opus-4-8', codex: 'gpt-5' })).toEqual({
      claude: 'claude-opus-4-8',
      codex: 'gpt-5'
    })
  })

  it('drops non-string entries from a map, keeping the valid ones', () => {
    expect(normalizePromptModel({ claude: 'opus', codex: 123, weird: null })).toEqual({ claude: 'opus' })
  })

  it('treats an empty map, an all-invalid map, an array, or a non-object as absent', () => {
    expect(normalizePromptModel({})).toBeUndefined()
    expect(normalizePromptModel({ claude: 5 })).toBeUndefined()
    expect(normalizePromptModel(['a', 'b'])).toBeUndefined()
    expect(normalizePromptModel(42)).toBeUndefined()
    expect(normalizePromptModel(undefined)).toBeUndefined()
    expect(normalizePromptModel(null)).toBeUndefined()
  })
})

describe('pickPromptModel', () => {
  it('returns a bare string for any tool (applied to whatever runs it)', () => {
    expect(pickPromptModel('claude-opus', 'claude')).toBe('claude-opus')
    expect(pickPromptModel('claude-opus', 'codex')).toBe('claude-opus')
  })

  it('picks the active tool\'s entry from a per-tool map', () => {
    const map = { claude: 'claude-opus-4-8', codex: 'gpt-5' }
    expect(pickPromptModel(map, 'claude')).toBe('claude-opus-4-8')
    expect(pickPromptModel(map, 'codex')).toBe('gpt-5')
  })

  it('returns undefined when the map names no model for the active tool', () => {
    expect(pickPromptModel({ claude: 'opus' }, 'codex')).toBeUndefined()
  })

  it('returns undefined when no model was declared', () => {
    expect(pickPromptModel(undefined, 'claude')).toBeUndefined()
  })
})

describe('per-tool map end to end (resolveModelArgs ∘ pickPromptModel)', () => {
  const tool = { modelArgs: ['--model', '{{model}}'], defaultModel: 'fallback' }
  const map = { claude: 'claude-opus-4-8', codex: 'gpt-5' }

  it('emits the tool-specific model for a tool named in the map', () => {
    expect(resolveModelArgs(tool, pickPromptModel(map, 'claude'))).toEqual(['--model', 'claude-opus-4-8'])
    expect(resolveModelArgs(tool, pickPromptModel(map, 'codex'))).toEqual(['--model', 'gpt-5'])
  })

  it('falls back to the tool defaultModel when the map omits the active tool', () => {
    expect(resolveModelArgs(tool, pickPromptModel(map, 'gemini'))).toEqual(['--model', 'fallback'])
  })
})
