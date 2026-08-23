import { basename, dirname, join } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { seedHome } from './fixtures'
import { ensureChromedriver } from './chromedriver'

const e2eDir = dirname(fileURLToPath(import.meta.url))

const capability: WebdriverIO.Capabilities = {
  browserName: 'electron',
  'wdio:electronServiceOptions': {
    // entry.mjs redirects HOME/userData into the sandbox, then imports the
    // real built bundle - so this tests out/, and `pnpm test:e2e` builds first.
    appEntryPoint: join(e2eDir, 'entry.mjs')
  }
}

export const config: WebdriverIO.Config = {
  runner: 'local',
  specs: ['./specs/*.e2e.ts'],
  // One app instance at a time: each spec file boots its own sandboxed app, and
  // pty work plus chromedriver startup make parallel instances flaky for nothing.
  maxInstances: 1,
  capabilities: [capability],
  services: ['electron'],
  framework: 'mocha',
  reporters: ['spec'],
  outputDir: join(e2eDir, '.logs'),
  mochaOpts: { ui: 'bdd', timeout: 90_000 },
  // Fetch chromedriver ourselves (see chromedriver.ts) and pin it on the
  // capability so wdio's flaky built-in download never runs.
  async onPrepare(_config, capabilities) {
    const binary = await ensureChromedriver()
    for (const cap of capabilities as WebdriverIO.Capabilities[]) {
      cap['wdio:chromedriverOptions'] = { binary } as never
    }
  },
  // Crashed or timed-out runs can strand app instances (macOS keeps a windowless
  // app alive); sweep anything still running our test entry. The match is the
  // entry script's path, so a real installed SeniorDev can never be hit.
  onComplete() {
    try {
      execSync("pkill -f 'e2e/entry.mjs'")
    } catch {
      // pkill exits 1 when there was nothing to kill - the good case
    }
  },
  // Seed the scenario sandbox before the app launches. The scenario is the spec
  // file's basename; SENIORDEV_E2E_HOME reaches the Electron child through the
  // worker's environment (worker -> chromedriver -> electron).
  beforeSession(_config, caps, specs) {
    const scenario = basename(specs[0]).replace(/\.e2e\.ts$/, '')
    const home = seedHome(scenario)
    process.env.SENIORDEV_E2E_HOME = home
    const opts = (caps as WebdriverIO.Capabilities)['wdio:electronServiceOptions'] as { appArgs?: string[] }
    opts.appArgs = [`--user-data-dir=${join(home, 'userData')}`]
  }
}
