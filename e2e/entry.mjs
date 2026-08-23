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

const { app } = await import('electron')
// The app's own window-all-closed handler deliberately keeps macOS running with
// zero windows (schedules fire windowless). Under test that behaviour strands a
// dock corpse per spec once chromedriver drops the session, so the test entry
// adds a quit. The app's handler still runs first and does its cleanup.
app.on('window-all-closed', () => app.quit())

await import('../out/main/index.js')
