// E2E entry: the real main bundle behind test isolation. Everything the app
// persists derives from homedir() (config, stores, transcript lookup), so HOME
// is redirected into the per-run sandbox BEFORE the bundle's module-level code
// runs. userData (and with it the single-instance lock and DevToolsActivePort)
// is NOT set here: it rides in as --user-data-dir from wdio.conf.ts, because
// chromedriver reads DevToolsActivePort from the profile dir named in the args
// and a runtime setPath would move the file out from under it.
const home = process.env.SENIORDEV_E2E_HOME
if (!home) throw new Error('SENIORDEV_E2E_HOME is not set; run via e2e/wdio.conf.ts')
process.env.HOME = home

await import('../out/main/index.js')
