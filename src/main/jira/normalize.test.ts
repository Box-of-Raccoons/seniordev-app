import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeIssue } from './normalize'

const raw = JSON.parse(
  readFileSync(join(__dirname, '../../../test/fixtures/issue-basic.json'), 'utf8')
)

describe('normalizeIssue', () => {
  it('maps standard fields into a Ticket', () => {
    const t = normalizeIssue(raw, 'https://acme.atlassian.net/')
    expect(t.key).toBe('PROJ-123')
    expect(t.type).toBe('Bug')
    expect(t.status).toBe('In Progress')
    expect(t.summary).toBe('Login button dead on iOS')
    expect(t.descriptionAdf?.type).toBe('doc')
    expect(t.comments).toHaveLength(1)
    expect(t.comments[0].author).toBe('Jane Dev')
    expect(t.url).toBe('https://acme.atlassian.net/browse/PROJ-123')
  })

  it('defaults missing fields safely', () => {
    const t = normalizeIssue({ key: 'X-1', fields: {} }, 'https://acme.atlassian.net')
    expect(t.type).toBe('')
    expect(t.status).toBe('')
    expect(t.descriptionAdf).toBeNull()
    expect(t.comments).toEqual([])
  })
})
