import { describe, expect, it } from 'vitest'
import { buildCatalog } from './catalog'
import type { PromptTemplate } from '../prompts/library'

const p = (name: string, description = ''): PromptTemplate => ({ name, description, body: '' })

describe('buildCatalog', () => {
  it('renders one line per prompt as "- name: description"', () => {
    expect(buildCatalog([p('fix-bug', 'fixes bugs'), p('add-feature', 'ships features')])).toBe(
      '- fix-bug: fixes bugs\n- add-feature: ships features'
    )
  })
  it('falls back to (no description) when description is empty', () => {
    expect(buildCatalog([p('fix-bug')])).toBe('- fix-bug: (no description)')
  })
  it('excludes a prompt named jira-orchestrator', () => {
    expect(buildCatalog([p('jira-orchestrator', 'router'), p('fix-bug', 'x')])).toBe('- fix-bug: x')
  })
  it('returns a placeholder for an empty list', () => {
    expect(buildCatalog([])).toBe('(no playbooks available)')
  })
})
