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
import { registerUpdateIpc } from './ipc/update-handlers'
// electron-updater is CommonJS and has no named ESM exports: `import { autoUpdater }`
// compiles but is undefined at runtime. The default-import destructure is the
// supported form.
import electronUpdater from 'electron-updater'
import { registerConfigIpc } from './ipc/config-handlers'
import { registerPromptConfigIpc } from './ipc/prompt-config-handlers'
import { installMenu } from './menu'
import { nodePtySpawner } from './terminal/node-pty-spawner'
import { nodeHeadlessSpawner } from './headless/node-spawner'
import { systemResolveCommand, systemCommandAvailable } from './terminal/resolve-command'
import { parseDeepLink, findDeepLinkArg } from './deeplink/parse'
import { resolveSecondInstance } from './startup/resolve-launch'
import { findRepoForTicket } from './config/repos'
import { DeepLinkDelivery, WarmDelivery } from './deeplink/delivery'
import { DEEPLINK, STARTUP, STATUS, GATE, WORKSPACE, SIDEBAR, SCHEDULES, type WorkspaceLayout, type WarmStartup, type ScheduledResume, type ScheduleResumeDropped } from '../shared/ipc'
import { registerSidebarIpc } from './ipc/sidebar-handlers'
import { registerScheduleIpc } from './ipc/schedule-handlers'
import { registerWorktreeIpc } from './ipc/worktree-handlers'
import { registerReviewIpc } from './ipc/review-handlers'
import { registerGateIpc } from './ipc/gate-handlers'
import { createGateService } from './gate/gate-service'
import { nodeGateRunner } from './gate/node-gate-runner'
import { nodeGitRunner } from './git/node-git-runner'
import { createSessionActivity } from './terminal/activity'
import { createPromptDelivery } from './terminal/prompt-delivery'
import { deliveryOptionsFor } from './terminal/delivery-options'
import { createSchedulesStore, type SchedulesStore } from './schedule/schedules-store'
import { createScheduleRunner, type ScheduleRunner } from './schedule/runner'
import { showScheduleNotice } from './schedule/notify'
import { isConversationResumable } from './session-resumable'
import { createStatusHub } from './terminal/status-hub'
import { createSessionPersistence, type SessionPersistence } from './session-persistence'
import { pollForTitle } from './session-title'
import { createWorkspaceStore, type WorkspaceStore } from './store/workspace-store'
import { startSubagentForwarding } from './subagents/forwarder'
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
let subagents: { dispose: () => void } | null = null
let schedules: SchedulesStore | null = null
let scheduleRunner: ScheduleRunner | null = null
let mainWindow: BrowserWindow | null = null

// Warm links are queued until the renderer says it's listening (DEEPLINK.ready);
// pre-ready links either summon a window or ride the cold-start StartupOptions.
const deepLinks = new DeepLinkDelivery({
  send: (link) => mainWindow?.webContents.send(DEEPLINK.event, link),
  ensureWindow: () => {
    if (app.isReady() && BrowserWindow.getAllWindows().length === 0) createWindow()
  }
})

// Warm CLI sessions (a second `seniordev --prompt …` launch) ride the same
// queue-until-ready machinery as deep links, flushed by the shared DEEPLINK.ready
// signal — see the second-instance handler below.
const startupSessions = new WarmDelivery<WarmStartup>({
  send: (warm) => mainWindow?.webContents.send(STARTUP.session, warm),
  ensureWindow: () => {
    if (app.isReady() && BrowserWindow.getAllWindows().length === 0) createWindow()
  }
})

// A scheduled resume rides the same queue-until-ready machinery: a schedule can
// come due with no window open (macOS keeps the app alive with none), and the
// firing must summon one rather than be dropped on the floor.
const scheduleResumes = new WarmDelivery<ScheduledResume>({
  send: (r) => mainWindow?.webContents.send(SCHEDULES.resume, r),
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
    startupSessions.windowClosed()
    scheduleResumes.windowClosed()
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
    const action = resolveSecondInstance(argv, (p) => readFileSync(p, 'utf8'))
    if (action.kind === 'session') {
      for (const w of action.warnings) console.error('[startup]', w)
      startupSessions.deliver(action.warm)
      return
    }
    for (const link of action.links) deepLinks.deliver(link)
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
    ipcMain.on(DEEPLINK.ready, () => {
      deepLinks.rendererReady()
      startupSessions.rendererReady()
      scheduleResumes.rendererReady()
    })
    registerPromptsIpc(store.prompts)
    const getSender = (): Electron.WebContents | undefined =>
      BrowserWindow.getFocusedWindow()?.webContents ?? BrowserWindow.getAllWindows()[0]?.webContents
    // S1 status. The activity tracker still backs prompt delivery (byte-quiet).
    // The hub turns events into glyph updates; idle is detected renderer-side by
    // buffer-content stability (these TUIs never go byte-quiet) and arrives as
    // STATUS.active / STATUS.settled.
    const activity = createSessionActivity()
    // Supervision slice 2: the gate watches the same status stream. It is wired
    // into sendUpdate rather than given its own listener so it can never see a
    // state the renderer did not, and it swallows its own failures so a broken
    // gate cannot break status reporting.
    const gates = createGateService({
      getConfig: () => store.config,
      runner: nodeGateRunner,
      onResult: (e) => getSender()?.send(GATE.result, e),
      onRunning: (e) => getSender()?.send(GATE.running, e)
    })
    const statusHub = createStatusHub({
      sendUpdate: (ev) => {
        getSender()?.send(STATUS.update, ev)
        void gates.onStatus(ev).catch(() => {})
      }
    })
    ipcMain.on(STATUS.active, (_e, id: string) => statusHub.active(id))
    ipcMain.on(STATUS.settled, (_e, id: string, text: string) => statusHub.settled(id, text))
    // S3 persistence: the project + conversation stores and the session-id capture
    // service. On first run (empty project list) seed from recent-folders so the
    // sidebar is not empty on day one (spec 4.4). Best-effort; a store failure
    // must never block a launch, so wrap it.
    persistence = createSessionPersistence({
      onChange: () => getSender()?.send(SIDEBAR.changed),
      // S7: live-backfill a bare conversation's title from its first transcript
      // message (re-reads the conversation each tick to pick up a discovered codex id).
      pollTitle: (getConv) => pollForTitle(getConv)
    })
    try {
      if (persistence.projects.list().length === 0) {
        persistence.projects.seedFromRecent(loadRecent(), store.config?.defaultTool ?? 'claude')
      }
      // Backfill codex ids the live poll missed on prior runs (the rollout files
      // persist on disk), so a real codex session isn't stuck showing inert.
      const filled = persistence.backfillCodexSessions()
      if (filled) console.log(`[persistence] backfilled ${filled} codex session id(s)`)
      // S7: retitle auto-titled conversations from prior runs whose transcripts are
      // now on disk, so the sidebar shows real names on boot.
      const titled = persistence.backfillTitles()
      if (titled) console.log(`[persistence] backfilled ${titled} conversation title(s)`)
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
    registerReviewIpc({ gitRunner: nodeGitRunner, persistence })
    registerGateIpc({ gates })
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
    // One prompt delivery for the whole app: the spawn path and the schedule
    // runner both write through it, so its cancel map covers a scheduled delivery
    // in flight as well as a launch one. `terminals` is assigned on the next line
    // and the write only runs later, from a timer.
    const promptDelivery = createPromptDelivery({
      write: (id, data) => terminals?.write(id, data),
      activity
    })
    terminals = registerTerminalIpc(getSender, nodePtySpawner, { source: store, resolveCommand: systemResolveCommand, activity, statusHub, gates, persistence, promptDelivery })
    yolo = registerYoloIpc(getSender, nodeHeadlessSpawner, { source: store, resolveCommand: systemResolveCommand, statusHub })

    // Scheduled prompts. The runner is the only thing here that acts on its own,
    // so every path it can take is gated: it writes into a live session only when
    // that session is idle, and refuses one sitting at an approval prompt. The two
    // paths that need a tab go out through the renderer, because main cannot make
    // one — a launch reuses the warm-CLI-session push, a resume uses its own.
    schedules = createSchedulesStore()
    const schedulesStore = schedules
    scheduleRunner = createScheduleRunner({
      store: schedulesStore,
      executor: {
        injectIntoTab: (ptyId, prompt, conversationId) => {
          // Bracketed paste is per tool (codex yes, claude no — the raw ESC would
          // clear its composer), resolved through the same helper the spawn path
          // uses so the two write paths cannot disagree. No config throws rather
          // than guessing: fire() records the throw as a failed firing, which
          // notifies, instead of typing an unframed multi-line prompt into codex.
          const { bracketedPaste } = deliveryOptionsFor(
            persistence?.conversations.get(conversationId)?.tool,
            store.config ?? null
          )
          // deliverNow, not deliver: the hub has just reported this tab idle, so a
          // readiness wait would only add the 15s valve and a window in which the
          // session could reach an approval prompt and be typed into anyway.
          promptDelivery.deliverNow(ptyId, prompt, bracketedPaste)
        },
        resumeConversation: (schedule, conversationId) => {
          const conv = persistence?.conversations.get(conversationId)
          if (!conv) return { ok: false, reason: 'the conversation is no longer stored' }
          // Asked fresh, from the agent's own transcript, exactly as the sidebar
          // does: a stored id is not proof there is anything to resume.
          if (!isConversationResumable(conv)) return { ok: false, reason: 'the agent has no transcript to resume' }
          scheduleResumes.deliver({
            conversationId,
            prompt: schedule.prompt,
            scheduleId: schedule.id,
            title: schedule.title
          })
          return { ok: true }
        },
        launch: (schedule) => {
          if (schedule.target.kind !== 'launch') return
          startupSessions.deliver({ session: schedule.target.session, ticket: schedule.target.ticket })
        }
      },
      ptyForConversation: (conversationId) => persistence?.ptyForConversation(conversationId),
      statusOf: (ptyId) => statusHub.statusOf(ptyId),
      conversationIsLive: (conversationId) => {
        const conv = persistence?.conversations.get(conversationId)
        return !!conv && conv.archivedAt === null
      },
      // Main-process Notification, not a renderer push: a startup-miss notice
      // fires on the runner's first tick, before any window exists to listen.
      notify: (schedule, outcome, reason) => {
        showScheduleNotice({ title: schedule.title, outcome, reason })
      },
      onChanged: () => getSender()?.send(SCHEDULES.changed)
    })
    // The first tick runs here, catching anything whose slot passed while the app
    // was closed. Nothing fires before this point, so a schedule cannot race the
    // renderer's readiness: a delivery that needs a tab queues until it signals.
    registerScheduleIpc({ store: schedulesStore, getSender, runner: scheduleRunner })
    // A resume push the renderer could not complete. The stored record already
    // says `fired` — main handed the resume off and the runner had no way to hear
    // back — so this notice is the user-visible correction, not a rewrite of the
    // outcome. A full main↔renderer ack protocol was deliberately deferred.
    ipcMain.on(SCHEDULES.resumeDropped, (_e, payload: ScheduleResumeDropped) => {
      showScheduleNotice({ title: payload.title, outcome: 'skipped', reason: payload.reason })
    })
    scheduleRunner.start()
    registerAppIpc()
    // Auto-update: downloads in the background, installs on quit. Inert in an
    // unpackaged build, so `pnpm dev` never talks to the release feed.
    registerUpdateIpc({ updater: electronUpdater.autoUpdater, getSender, isPackaged: app.isPackaged })
    registerConfigIpc(store, getSender)
    registerPromptConfigIpc(store, getSender)
    installMenu(getSender)
    // S8: start the read-only subagent-activity watchers and push their events to
    // the renderer's panel. Global (every subagent on the machine); the renderer
    // filters to this app's sessions when "this app only" is on.
    subagents = startSubagentForwarding({ getSender })

    // The runner's first tick (scheduleRunner.start(), above) can already have
    // summoned a window via ensureWindow() for a schedule due at boot; only open
    // one here if it didn't, or a due schedule opens two.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', () => {
    scheduleRunner?.stop()
    schedules?.flush()
    terminals?.killAll()
    yolo?.killAll()
    subagents?.dispose()
    persistence?.flush()
    workspace?.flush()
  })
  app.on('window-all-closed', () => {
    terminals?.killAll()
    yolo?.killAll()
    subagents?.dispose()
    persistence?.flush()
    workspace?.flush()
    if (process.platform !== 'darwin') app.quit()
  })
}
