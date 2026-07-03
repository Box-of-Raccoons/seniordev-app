import { describe, expect, it } from 'vitest'
import { extractVerdict } from './extract'

describe('extractVerdict', () => {
  it('parses a bare JSON object on its own line', () => {
    expect(extractVerdict('{"prompt": "fix-bug"}')).toEqual({ prompt: 'fix-bug' })
  })
  it('parses JSON inside a ```json fence', () => {
    expect(extractVerdict('```json\n{"prompt": "fix-bug"}\n```')).toEqual({ prompt: 'fix-bug' })
  })
  it('finds the object amid surrounding prose', () => {
    expect(extractVerdict('After review, my choice is {"prompt": "add-feature"} — done.')).toEqual({ prompt: 'add-feature' })
  })
  it('returns the last valid verdict when the model restates', () => {
    expect(extractVerdict('{"prompt": "first"}\n...on reflection...\n{"prompt": "second"}')).toEqual({ prompt: 'second' })
  })
  it('carries prompt:null with its reason', () => {
    expect(extractVerdict('{"prompt": null, "reason": "no playbook fits"}')).toEqual({ prompt: null, reason: 'no playbook fits' })
  })
  it('parses a verdict whose reason contains braces in the string', () => {
    expect(extractVerdict('{"prompt": null, "reason": "none fit; use the {custom} flow"}')).toEqual({
      prompt: null,
      reason: 'none fit; use the {custom} flow'
    })
  })
  it('parses a verdict containing a nested object', () => {
    expect(extractVerdict('{"prompt": "fix-bug", "meta": {"confidence": 0.9}}')).toEqual({ prompt: 'fix-bug' })
  })
  it('handles escaped quotes inside string values', () => {
    expect(extractVerdict('{"prompt": null, "reason": "say \\"hi {there}\\" first"}')).toEqual({
      prompt: null,
      reason: 'say "hi {there}" first'
    })
  })
  it('still takes the last verdict when earlier text has stray braces', () => {
    expect(extractVerdict('{ not json {\n{"prompt": "first"}\n{"prompt": "second"}')).toEqual({ prompt: 'second' })
  })
  it('returns null when there is no JSON', () => {
    expect(extractVerdict('I could not decide.')).toBeNull()
  })
  it('returns null for a JSON object without a prompt key', () => {
    expect(extractVerdict('{"choice": "fix-bug"}')).toBeNull()
  })
})
