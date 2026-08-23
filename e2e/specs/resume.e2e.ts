// A schedule aimed at a closed conversation: main queues a resume push, the
// renderer opens a tab with the tool's resumeArgs, and the scheduled prompt is
// typed into the new pty. This is the path review finding 1 found completely
// dead (the queue never flushed) - the regression test is the whole round trip.
import { browser, $, expect } from '@wdio/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AGENT_SESSION_ID, RESUME_PROMPT } from '../fixtures'

describe('a resume schedule for a closed conversation', () => {
  it('reopens the conversation with resume args and delivers the prompt', async () => {
    const tab = $('.term-tab')
    await tab.waitForExist({ timeout: 30_000 })

    const log = join(process.env.SENIORDEV_E2E_HOME as string, 'fake-cli.log')
    await browser.waitUntil(
      () => {
        try {
          return readFileSync(log, 'utf8').includes(RESUME_PROMPT)
        } catch {
          return false
        }
      },
      { timeout: 30_000, timeoutMsg: 'the scheduled resume prompt never reached the fake CLI' }
    )

    // The spawn carried the tool's resumeArgs with the stored session id.
    const spawn = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { ev: string; data: unknown })
      .find((e) => e.ev === 'spawn')
    expect(spawn?.data).toEqual(['--resume', AGENT_SESSION_ID])
  })
})
