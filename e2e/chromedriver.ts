// wdio's own chromedriver setup dies mid-download in this environment (SIGINT
// from its bundled downloader), so the launcher fetches the driver itself with
// @puppeteer/browsers - proven stable here - and hands wdio the binary, which
// makes the run deterministic and offline-friendly after the first fetch.
import { install, resolveBuildId, detectBrowserPlatform, Browser } from '@puppeteer/browsers'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

export async function ensureChromedriver(): Promise<string> {
  const e2eDir = dirname(fileURLToPath(import.meta.url))
  const electronVersion = (
    JSON.parse(readFileSync(join(e2eDir, '..', 'node_modules', 'electron', 'package.json'), 'utf8')) as {
      version: string
    }
  ).version
  const fullVersions = (await import('electron-to-chromium/full-versions.js')).default as Record<string, string>
  const chrome = fullVersions[electronVersion] ?? fullVersions[electronVersion.split('.').slice(0, 2).join('.')]
  if (!chrome) throw new Error(`no chromium mapping for electron ${electronVersion}`)
  const platform = detectBrowserPlatform()
  if (!platform) throw new Error('unsupported platform for chromedriver')
  // The exact electron chromium build often has no chrome-for-testing artifact;
  // the latest driver of the same milestone speaks the same protocol.
  const buildId = await resolveBuildId(Browser.CHROMEDRIVER, platform, chrome.split('.')[0])
  const installed = await install({
    cacheDir: join(e2eDir, '.cache'),
    browser: Browser.CHROMEDRIVER,
    buildId,
    unpack: true
  })
  return installed.executablePath
}
