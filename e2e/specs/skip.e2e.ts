// A resume schedule whose conversation has no session id to resume: the firing
// must record the honest skip with its reason (not 'fired'), and no tab may
// appear. The notice itself is an OS toast, deliberately not asserted here.
// The record is read straight from the sandbox's schedules.json - the spec
// process shares the filesystem with the app under test.
import { browser, $$, expect } from '@wdio/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface StoredSchedule {
  lastOutcome: string | null
  lastReason: string | null
  enabled: boolean
}

function readSchedule(): StoredSchedule | null {
  const file = join(process.env.SENIORDEV_E2E_HOME as string, '.config', 'SeniorDev', 'schedules.json')
  try {
    const doc = JSON.parse(readFileSync(file, 'utf8')) as { schedules: StoredSchedule[] }
    return doc.schedules[0] ?? null
  } catch {
    return null // mid-write or not yet flushed; poll again
  }
}

describe('a resume schedule with nothing to resume', () => {
  it('records the skip with its reason and opens no tab', async () => {
    await browser.waitUntil(() => readSchedule()?.lastOutcome === 'skipped', {
      timeout: 30_000,
      timeoutMsg: 'the schedule never recorded a skipped outcome'
    })

    const stored = readSchedule()
    expect(stored?.lastReason).toBe('the agent has no transcript to resume')
    // A one-shot that could not run retires rather than rescheduling.
    expect(stored?.enabled).toBe(false)

    const tabs = await $$('.term-tab').length
    expect(tabs).toBe(0)
  })
})
