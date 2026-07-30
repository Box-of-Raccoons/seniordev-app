import { app, BrowserWindow, ipcMain, session, shell } from 'electron'
import { join, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { defaultConfigDir } from './config/paths'
import { applyFixedPath } from './env/fix-path'
import { parseStartupArgs } from './cli/parse-args'
import { registerStartupIpc } from './ipc/startup-handlers'
import { ConfigStore } from './config/store'
import { registerReposIpc } from './ipc/handlers'
import { registerTerminalIpc } from './ipc/terminal-handlers'
import { registerYoloIpc } from './ipc/yolo-handlers'
import { registerPromptsIpc } from './ipc/prompts-handlers'
import { seedDefaultPrompts } from './prompts/defaults'
import { registerShellIpc } from './ipc/shell-handlers'
import { registerComposerIpc } from './ipc/composer-handlers'
import { registerRecentIpc } from './ipc/recent-handlers'
import { registerClipboardIpc } from './ipc/clipboard-handlers'
import { registerAppIpc } from './ipc/app-handlers'
import { registerConfigIpc } from './ipc/config-handlers'
import { registerPromptConfigIpc } from './ipc/prompt-config-handlers'
import { installMenu } from './menu'
import { nodePtySpawner } from './terminal/node-pty-spawner'
import { nodeHeadlessSpawner } from './headless/node-spawner'
import { systemResolveCommand, systemCommandAvailable } from './terminal/resolve-command'
import { parseDeepLink, findDeepLinkArg, linksFromArgv } from './deeplink/parse'
import { findRepoForTicket } from './config/repos'
import { DeepLinkDelivery } from './deeplink/delivery'
import { DEEPLINK, STATUS, WORKSPACE, SIDEBAR, type WorkspaceLayout } from '../shared/ipc'
import { registerSidebarIpc } from './ipc/sidebar-handlers'
import { registerWorktreeIpc } from './ipc/worktree-handlers'
import { nodeGitRunner } from './git/node-git-runner'
import { createSessionActivity } from './terminal/activity'
import { createStatusHub } from './terminal/status-hub'
import { createSessionPersistence, type SessionPersistence } from './session-persistence'
import { createWorkspaceStore, type WorkspaceStore } from './store/workspace-store'
import { loadRecent } from './recent-folders'
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
let persistence: SessionPersistence | null = null
let workspace: WorkspaceStore | null = null
let mainWindow: BrowserWindow | null = null

// Warm links are queued until the renderer says it's listening (DEEPLINK.ready);
// pre-ready links either summon a window or ride the cold-start StartupOptions.
const deepLinks = new DeepLinkDelivery({
  send: (link) => mainWindow?.webContents.send(DEEPLINK.event, link),
  ensureWindow: () => {
    if (app.isReady() && BrowserWindow.getAllWindows().length === 0) createWindow()
  }
})

function createWindow(): void {
  // S3: restore the last window size/position from workspace.json; fall back to
  // the default 1400x900 on first run or a corrupt/missing store.
  const saved = workspace?.getWindowBounds()
  const win = new BrowserWindow({
    width: saved?.width ?? 1400,
    height: saved?.height ?? 900,
    x: saved?.x,
    y: saved?.y,
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
  // S3: persist window size/position as the user resizes/moves it. The store
  // debounces the disk write, so wiring these high-frequency events is cheap.
  const saveBounds = (): void => workspace?.setWindowBounds(win.getBounds())
  win.on('resize', saveBounds)
  win.on('move', saveBounds)
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
  win.on('ready-to-show', () => win.show())
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
    focusMainWindow()
    for (const link of linksFromArgv(argv)) deepLinks.deliver(link)
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
    // A GUI-launched macOS/Linux app inherits launchd's minimal PATH, not the
    // user's shell PATH — so node-pty can't find CLI tools installed under
    // ~/.local/bin, /opt/homebrew/bin, a version manager, etc., and every session
    // dies with "[process exited: 1]". Recover the login shell's PATH before any
    // terminal/headless spawner is wired up below. No-op on Windows.
    const fixedPath = applyFixedPath()
    if (fixedPath) console.log('[env] applied login shell PATH')

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

    registerReposIpc((key) => {
      const cfg = store.config
      if (!cfg) return null
      const repo = findRepoForTicket(cfg, key)
      return repo ? { key: repo.key, path: repo.path, tool: cfg.defaultTool } : null
    })
    registerShellIpc()
    registerComposerIpc({ getConfig: () => store.config, isAvailable: systemCommandAvailable })
    registerRecentIpc()
    registerClipboardIpc()
    const startup = parseStartupArgs(process.argv.slice(1), (p) => readFileSync(p, 'utf8'))
    for (const w of startup.warnings ?? []) console.error('[startup]', w)

    // Cold start: a deep link may arrive in argv (Windows/Linux) or via a
    // pre-ready open-url (macOS, queued in deepLinks). Carry the first one through
    // as startup.deeplink so the renderer prefills a composer for it.
    const rawLink = findDeepLinkArg(process.argv.slice(1))
    const argvLink = rawLink ? parseDeepLink(rawLink) : null
    const coldLink = argvLink ?? deepLinks.drainPending()[0]
    if (coldLink) {
      if (!startup.tickets.includes(coldLink.ticket)) startup.tickets = [...startup.tickets, coldLink.ticket]
      startup.deeplink = coldLink
    }
    registerStartupIpc(startup)
    // Renderer listener attached → flush any queued warm links from now on.
    ipcMain.on(DEEPLINK.ready, () => deepLinks.rendererReady())
    registerPromptsIpc(store.prompts)
    const getSender = (): Electron.WebContents | undefined =>
      BrowserWindow.getFocusedWindow()?.webContents ?? BrowserWindow.getAllWindows()[0]?.webContents
    // S1 status. The activity tracker still backs prompt delivery (byte-quiet).
    // The hub turns events into glyph updates; idle is detected renderer-side by
    // buffer-content stability (these TUIs never go byte-quiet) and arrives as
    // STATUS.active / STATUS.settled.
    const activity = createSessionActivity()
    const statusHub = createStatusHub({ sendUpdate: (ev) => getSender()?.send(STATUS.update, ev) })
    ipcMain.on(STATUS.active, (_e, id: string) => statusHub.active(id))
    ipcMain.on(STATUS.settled, (_e, id: string, text: string) => statusHub.settled(id, text))
    // S3 persistence: the project + conversation stores and the session-id capture
    // service. On first run (empty project list) seed from recent-folders so the
    // sidebar is not empty on day one (spec 4.4). Best-effort; a store failure
    // must never block a launch, so wrap it.
    persistence = createSessionPersistence({ onChange: () => getSender()?.send(SIDEBAR.changed) })
    try {
      if (persistence.projects.list().length === 0) {
        persistence.projects.seedFromRecent(loadRecent(), store.config?.defaultTool ?? 'claude')
      }
      // Backfill codex ids the live poll missed on prior runs (the rollout files
      // persist on disk), so a real codex session isn't stuck showing inert.
      const filled = persistence.backfillCodexSessions()
      if (filled) console.log(`[persistence] backfilled ${filled} codex session id(s)`)
    } catch (err) {
      console.error('[persistence] seed/backfill skipped:', err)
    }
    // S3 workspace store: window bounds (restored in createWindow, below) and the
    // renderer-pushed pane/tab layout. Debounced to disk inside the store.
    workspace = createWorkspaceStore()
    ipcMain.on(WORKSPACE.save, (_e, layout: WorkspaceLayout) => workspace?.setLayout(layout))
    // S4: read-only projects/conversations + restore + sidebar-geometry read for
    // the Projects sidebar. Registered once both stores exist.
    registerSidebarIpc({ persistence, workspace, getSender, source: store })
    // S5: worktree info/create/teardown. All git shelling goes through nodeGitRunner
    // (the only child_process-for-git module); configDir is where worktrees live.
    registerWorktreeIpc({ gitRunner: nodeGitRunner, source: store, persistence, configDir: defaultConfigDir(), getSender })
    // S3 archive (spec 4.5): archive projects idle past archiveAfterDays, exempting
    // any with a live tab. Runs now and once daily; reversible; 0 days disables.
    const runArchive = (): void => {
      try {
        const archived = persistence?.runArchive(store.config?.archiveAfterDays ?? 14) ?? []
        if (archived.length) console.log(`[archive] archived ${archived.length} idle project(s)`)
      } catch (err) {
        console.error('[archive]', err)
      }
    }
    runArchive()
    setInterval(runArchive, 24 * 60 * 60 * 1000).unref?.()
    terminals = registerTerminalIpc(getSender, nodePtySpawner, { source: store, resolveCommand: systemResolveCommand, activity, statusHub, persistence })
    yolo = registerYoloIpc(getSender, nodeHeadlessSpawner, { source: store, resolveCommand: systemResolveCommand, statusHub })
    registerAppIpc()
    registerConfigIpc(store, getSender)
    registerPromptConfigIpc(store, getSender)
    installMenu(getSender)

    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', () => {
    terminals?.killAll()
    yolo?.killAll()
    persistence?.flush()
    workspace?.flush()
  })
  app.on('window-all-closed', () => {
    terminals?.killAll()
    yolo?.killAll()
    persistence?.flush()
    workspace?.flush()
    if (process.platform !== 'darwin') app.quit()
  })
}
