// A launch schedule due at boot: the runner's first tick runs before the boot
// createWindow(), so this is the double-window regression (review finding 3) and
// the queue-until-renderer-ready flush, end to end against the real app.
import { browser, $, expect } from '@wdio/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LAUNCH_PROMPT } from '../fixtures'

describe('a launch schedule due at boot', () => {
  it('opens exactly one window and delivers the prompt into the spawned session', async () => {
    const tab = $('.term-tab')
    await tab.waitForExist({ timeout: 30_000 })

    const windowCount = await browser.electron.execute((electron) => electron.BrowserWindow.getAllWindows().length)
    expect(windowCount).toBe(1)

    // The prompt is typed into the pty by prompt delivery (readiness wait, then
    // Enter as its own keystroke); the fake CLI logs every stdin chunk.
    const log = join(process.env.SENIORDEV_E2E_HOME as string, 'fake-cli.log')
    await browser.waitUntil(
      () => {
        try {
          return readFileSync(log, 'utf8').includes(LAUNCH_PROMPT)
        } catch {
          return false
        }
      },
      { timeout: 30_000, timeoutMsg: 'the scheduled launch prompt never reached the fake CLI' }
    )
  })
})
