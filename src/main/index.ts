import { app, BrowserWindow, ipcMain, session, shell } from 'electron'
import { join, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { defaultConfigDir } from './config/paths'
import { parseStartupArgs } from './cli/parse-args'
import { registerStartupIpc } from './ipc/startup-handlers'
import { ConfigStore } from './config/store'
import { registerIpc } from './ipc/handlers'
import { registerTerminalIpc } from './ipc/terminal-handlers'
import { registerYoloIpc } from './ipc/yolo-handlers'
import { registerOrchestratorIpc } from './ipc/orchestrator-handlers'
import { registerPromptsIpc } from './ipc/prompts-handlers'
import { seedDefaultPrompts } from './prompts/defaults'
import { registerShellIpc } from './ipc/shell-handlers'
import { registerComposerIpc } from './ipc/composer-handlers'
import { registerAppIpc } from './ipc/app-handlers'
import { registerConfigIpc } from './ipc/config-handlers'
import { registerPromptConfigIpc } from './ipc/prompt-config-handlers'
import { installMenu } from './menu'
import { nodePtySpawner } from './terminal/node-pty-spawner'
import { nodeHeadlessSpawner } from './headless/node-spawner'
import { systemResolveCommand } from './terminal/resolve-command'
import { parseDeepLink, findDeepLinkArg, linksFromArgv } from './deeplink/parse'
import { findRepoForTicket } from './config/repos'
import { DeepLinkDelivery } from './deeplink/delivery'
import { DEEPLINK, ORCHESTRATOR } from '../shared/ipc'
import type { TerminalManager } from './terminal/manager'
import type { YoloRunner } from './headless/runner'

function resolveConfigPath(): string {
  return process.env.SENIORDEV_CONFIG ?? join(defaultConfigDir(), 'config.yaml')
}

// Where the app's committed default prompts live at runtime: bundled under
// resourcesPath in a packaged build, or the repo's resources/prompts in dev.
function bundledPromptsDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'prompts')
    : join(app.getAppPath(), 'resources', 'prompts')
}

// The app logo for the running window/taskbar. electron-builder sets the packaged
// installer/exe icon from build/icon.png, but a BrowserWindow with no `icon` shows
// Electron's default at runtime (notably in dev and on Linux) — so point it at the
// same logo, shipped to <resourcesPath>/assets in packaged builds (extraResources).
function appIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'assets', 'icon.png')
    : join(app.getAppPath(), 'assets', 'icon.png')
}

const store = new ConfigStore(resolveConfigPath())

let terminals: TerminalManager | null = null
let yolo: YoloRunner | null = null
let orchestrator: import('./orchestrator/run').ClassifyEngine | null = null
let mainWindow: BrowserWindow | null = null

// Warm links are queued until the renderer says it's listening (DEEPLINK.ready);
// pre-ready links either summon a window or ride the cold-start StartupOptions.
const deepLinks = new DeepLinkDelivery({
  send: (link) => mainWindow?.webContents.send(DEEPLINK.event, link),
  ensureWindow: () => {
    if (app.isReady() && BrowserWindow.getAllWindows().length === 0) createWindow()
  }
})

function createWindow(minimized = false): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    // Show the SeniorDev logo (not Electron's default) on the window/taskbar at
    // runtime. Ignored on macOS (the .app bundle icon wins); matters on Windows
    // dev and Linux. See SD-2.
    icon: appIconPath(),
    // Paint the dark theme background (--bg) behind the renderer so any uncovered
    // frame between launch and first paint matches the UI instead of flashing
    // white. #131a17 is the sRGB form of oklch(0.21 0.012 165). See SD-2.
    backgroundColor: '#131a17',
    // sandbox:false is required for the ESM (.mjs) preload — sandboxed preloads
    // must be CJS. Don't "fix" this to true without also converting the preload.
    webPreferences: { preload: join(__dirname, '../preload/index.mjs'), sandbox: false }
  })
  mainWindow = win
  // Electron hardening (SD-9 S1): remote ticket content renders links as in-app
  // anchors. Never let the webContents open a new window or navigate itself —
  // route http(s) out through the OS browser (the vetted shell.openExternal path)
  // and deny everything else. Defense-in-depth on top of safeUrl's href allowlist.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault()
  })
  // A watcher-launched run starts minimized (visible in the taskbar, not stealing
  // focus); a normal launch shows and focuses.
  win.on('ready-to-show', () => {
    if (minimized) { win.showInactive(); win.minimize() }
    else win.show()
  })
  win.on('closed', () => {
    mainWindow = null
    deepLinks.windowClosed()
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

function focusMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}

// Single-instance lock first: a second protocol launch must forward its argv to
// the running instance (below) instead of opening a second window.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  // Dev runs read package.json's `name` (seniordev-app) for app.getName();
  // packaged builds get productName from electron-builder.yml. Pin it for both
  // so About (app:info) always shows the product name.
  app.setName('SeniorDev')
  // B3 (SD-9): Windows toast notifications require an AppUserModelID matching the
  // installed shortcut (== electron-builder appId) or they silently never display.
  app.setAppUserModelId('com.boxofraccoons.seniordev')

  if (process.defaultApp) {
    if (process.argv.length >= 2) app.setAsDefaultProtocolClient('seniordev', process.execPath, [resolve(process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient('seniordev')
  }

  // Windows/Linux: a second launch delivers its argv here. Plain ticket keys
  // (`seniordev PROJ-123` while running) are forwarded as open links — before
  // the single-instance lock they opened in their own instance.
  app.on('second-instance', (_e, argv) => {
    // A warm `--orchestrate <ticket>` (from SeniorDevWatch): run it in a new tab
    // with no confirm gate. CLI-only, so it's not a web-reachable bypass.
    const argvLinks = linksFromArgv(argv)
    const opts = parseStartupArgs(argv.slice(1), () => '')
    // S3 (SD-9): the no-confirm orchestrate path assumes a trusted CLI argv. If
    // this same argv also carries a deep link (a web-reachable `seniordev://…`),
    // a lost-quoting quirk could smuggle `--orchestrate` past the confirm gate —
    // so if any deep link is present, ignore orchestrate and take the gated path.
    if (opts.orchestrate && argvLinks.length === 0) {
      if (!opts.minimized) focusMainWindow()
      mainWindow?.webContents.send(ORCHESTRATOR.run, opts.orchestrate)
      return
    }
    focusMainWindow()
    for (const link of argvLinks) deepLinks.deliver(link)
  })

  // macOS: the OS delivers the URL here (can fire before the window exists,
  // or while the app is alive with zero windows).
  app.on('open-url', (_e2, url) => {
    const link = parseDeepLink(url)
    if (!link) return
    focusMainWindow()
    deepLinks.deliver(link)
  })

  app.whenReady().then(() => {
    if (!process.env.ELECTRON_RENDERER_URL) {
      session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
        cb({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'"
            ]
          }
        })
      })
    }

    const boot = store.reload()
    if (!boot.ok) console.error('[config]', boot.error)

    // Deliver the shipped role-prompt library into the user's promptsDir on first
    // run (non-destructive; only fills in missing files), then reload so they show
    // up in the New Session / YOLO menu.
    if (boot.ok) {
      const seeded = seedDefaultPrompts(bundledPromptsDir(), store.promptsDir())
      if (seeded.length) {
        console.log('[prompts] seeded default prompts:', seeded.join(', '))
        store.reloadPrompts()
      }
    }

    registerIpc(store.getTicket, (key) => {
      const cfg = store.config
      if (!cfg) return null
      const repo = findRepoForTicket(cfg, key)
      return repo ? { key: repo.key, path: repo.path, tool: cfg.defaultTool } : null
    })
    registerShellIpc()
    registerComposerIpc({ getConfig: () => store.config, resolveCommand: systemResolveCommand })
    const startup = parseStartupArgs(process.argv.slice(1), (p) => readFileSync(p, 'utf8'))
    for (const w of startup.warnings ?? []) console.error('[startup]', w)

    // Cold start: the deep link arrives in argv (Windows/Linux) or via a
    // pre-ready open-url (macOS, queued in deepLinks). Ensure its ticket is
    // loaded; a yolo action also gets carried through so the renderer can run
    // the confirm gate + orchestrator.
    const rawLink = findDeepLinkArg(process.argv.slice(1))
    const argvLink = rawLink ? parseDeepLink(rawLink) : null
    for (const coldLink of [...(argvLink ? [argvLink] : []), ...deepLinks.drainPending()]) {
      if (!startup.tickets.includes(coldLink.ticket)) startup.tickets = [...startup.tickets, coldLink.ticket]
      if (coldLink.action === 'yolo') startup.deeplink = coldLink
    }
    registerStartupIpc(startup)
    // Renderer listener attached → flush any queued warm links from now on.
    ipcMain.on(DEEPLINK.ready, () => deepLinks.rendererReady())
    registerPromptsIpc(store.prompts)
    const getSender = (): Electron.WebContents | undefined =>
      BrowserWindow.getFocusedWindow()?.webContents ?? BrowserWindow.getAllWindows()[0]?.webContents
    terminals = registerTerminalIpc(getSender, nodePtySpawner, { source: store, resolveCommand: systemResolveCommand })
    yolo = registerYoloIpc(getSender, nodeHeadlessSpawner, { source: store, resolveCommand: systemResolveCommand })
    orchestrator = registerOrchestratorIpc(getSender, nodeHeadlessSpawner, { source: store, resolveCommand: systemResolveCommand, promptsDir: () => store.promptsDir() })
    registerAppIpc()
    registerConfigIpc(store, getSender)
    registerPromptConfigIpc(store, getSender)
    installMenu(getSender)

    createWindow(startup.minimized)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', () => {
    terminals?.killAll()
    yolo?.killAll()
    orchestrator?.killAll()
  })
  app.on('window-all-closed', () => {
    terminals?.killAll()
    yolo?.killAll()
    orchestrator?.killAll()
    if (process.platform !== 'darwin') app.quit()
  })
}
