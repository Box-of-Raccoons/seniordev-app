import { describe, it, expect } from 'vitest'
import { buildJql } from './jql'
import { WatchSchema } from '../main/config/schema'

const watch = WatchSchema.parse({})

describe('buildJql', () => {
  it('builds assignee + label + status-category query', () => {
    expect(buildJql(watch)).toBe(
      'assignee = currentUser() AND labels = "SeniorDev" AND statusCategory = "To Do"'
    )
  })

  it('reflects custom label and trigger status', () => {
    const w = WatchSchema.parse({ label: 'Auto', triggerStatusCategory: 'Backlog' })
    expect(buildJql(w)).toBe(
      'assignee = currentUser() AND labels = "Auto" AND statusCategory = "Backlog"'
    )
  })
})
