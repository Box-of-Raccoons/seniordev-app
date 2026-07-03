import { app, Tray, Menu, Notification, nativeImage, shell, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { ConfigStore } from '../main/config/store'
import { defaultConfigDir } from '../main/config/paths'
import { nodeHeadlessSpawner } from '../main/headless/node-spawner'
import { systemResolveCommand } from '../main/terminal/resolve-command'
import { buildHeadlessLaunch } from '../main/headless/launch'
import { createParser } from '../main/headless/parsers'
import { YoloRunner } from '../main/headless/runner'
import { buildForgePatterns } from '../main/terminal/pr-detector'
import { resolveExpandedPrompt } from '../main/ipc/resolve-prompt'
import { buildClassifyLaunch, createClassifyRunner } from '../main/orchestrator/run'
import { WatchState } from './state'
import { WatchDispatcher, type WatchNotification } from './dispatcher'
import type { Ticket } from '../shared/types'

function configPath(): string {
  return process.env.SENIORDEV_CONFIG ?? join(defaultConfigDir(), 'config.yaml')
}
function statePath(): string {
  return join(defaultConfigDir(), 'watch-state.json')
}
// The built tray entry is out/main/watch.js, so repo assets/ sits two levels up
// in dev; packaged builds ship assets/ under resourcesPath (electron-builder).
function assetPath(file: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'assets', file)
    : join(__dirname, '..', '..', 'assets', file)
}

// Single instance: a second tray launch just exits.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.setName('SeniorDevWatch')
  // No dock icon on macOS; this is a background agent.
  app.dock?.hide()

  app.whenReady().then(() => {
    const store = new ConfigStore(configPath())
    const boot = store.reload()
    const state = new WatchState(statePath())

    // Tray icons must be small (~16px); the source mascot.png is 1024² and shows
    // blank in the tray unless resized.
    const trayIcon = nativeImage.createFromPath(assetPath('mascot.png')).resize({ width: 16, height: 16 })
    const tray = new Tray(trayIcon)

    let paused = false
    let lastPoll = 'never'

    const isAuto = (): boolean => state.getAutoMode() ?? store.config?.watch.autoMode ?? false

    const notify = (n: WatchNotification): void => {
      const note = new Notification({ title: n.title, body: n.body })
      if (n.onClick) note.on('click', n.onClick)
      note.show()
    }

    // Stage-1 classify engine (reused across tickets); logs are dropped in the
    // tray (no renderer) — the verdict is what matters.
    const classifyEngine = createClassifyRunner(nodeHeadlessSpawner, () => {})
    const spawnResolvers = new Map<string, (r: { exitCode: number; prUrls: string[] }) => void>()
    // Stage-2 YOLO runner: resolve each run's exit into a promise for the queue.
    const yolo = new YoloRunner(nodeHeadlessSpawner, {
      onLog: () => {},
      onPr: () => {},
      onExit: (id, e) => spawnResolvers.get(id)?.({ exitCode: e.exitCode, prUrls: e.prUrls })
    })

    const dispatcher = new WatchDispatcher({
      config: () => {
        if (!store.config) throw new Error(store.loadError ?? 'config not loaded')
        return store.config
      },
      search: (jql) => {
        if (!store.jiraClient) throw new Error('config not loaded')
        return store.jiraClient.search(jql)
      },
      transition: (key, name) => {
        if (!store.jiraClient) throw new Error('config not loaded')
        return store.jiraClient.transition(key, name)
      },
      classify: async (ticket: Ticket) => {
        const cfg = store.config!
        const id = `watch-classify:${ticket.key}`
        const launch = await buildClassifyLaunch(cfg, store, store.promptsDir(), { id, ticketKey: ticket.key }, systemResolveCommand)
        return classifyEngine.run(id, launch, store.prompts, buildForgePatterns(cfg))
      },
      spawn: async (ticket: Ticket, _repoPath: string, promptName: string) => {
        const cfg = store.config!
        const id = `watch-run:${ticket.key}`
        const expanded = await resolveExpandedPrompt(cfg, store, { prompt: { name: promptName }, ticketKey: ticket.key })
        const launch = buildHeadlessLaunch(cfg, { ticketKey: ticket.key }, expanded ?? '', systemResolveCommand)
        return new Promise((resolve, reject) => {
          spawnResolvers.set(id, (r) => { spawnResolvers.delete(id); resolve(r) })
          try {
            yolo.start(id, {
              file: launch.file, args: launch.args, cwd: launch.cwd, prompt: launch.prompt,
              parser: createParser(launch.outputParser, launch.sessionIdPattern),
              patterns: buildForgePatterns(cfg), resolved: launch.resolved
            })
          } catch (err) {
            // start() threw (e.g. duplicate id) — drop the resolver so it can't
            // leak, and reject so the dispatcher surfaces it.
            spawnResolvers.delete(id)
            reject(err)
          }
        })
      },
      kill: (key: string) => {
        // Only one of these is live at a time; killing a stale id is a no-op.
        classifyEngine.kill(`watch-classify:${key}`)
        yolo.kill(`watch-run:${key}`)
      },
      state,
      notify,
      isAuto,
      now: () => new Date().toISOString()
    })

    const refreshMenu = (): void => {
      tray.setToolTip(
        dispatcher.inFlightCount > 0 ? `SeniorDevWatch — ${dispatcher.inFlightCount} running` : 'SeniorDevWatch — idle'
      )
      const pending = dispatcher.pendingApprovals()
      const approvals: MenuItemConstructorOptions[] = pending.length
        ? [
            { type: 'separator' },
            {
              label: `Pending approvals (${pending.length})`,
              submenu: pending.map((p) => ({
                label: `Approve ${p.key} — ${p.summary}`,
                click: () => { dispatcher.approve(p.key); refreshMenu() }
              }))
            }
          ]
        : []
      const menu = Menu.buildFromTemplate([
        { label: `SeniorDevWatch — last poll ${lastPoll}`, enabled: false },
        { label: `${dispatcher.inFlightCount} running · ${dispatcher.pendingCount} awaiting approval`, enabled: false },
        ...approvals,
        { type: 'separator' },
        { label: 'Auto-dispatch', type: 'checkbox', checked: isAuto(), click: (i) => { state.setAutoMode(i.checked); refreshMenu() } },
        { label: paused ? 'Resume polling' : 'Pause polling', click: () => { paused = !paused; refreshMenu() } },
        { label: 'Poll now', click: () => void runPoll(true) },
        { type: 'separator' },
        { label: 'Open config', click: () => void shell.openPath(store.configPath) },
        { label: 'Quit', click: () => { yolo.killAll(); classifyEngine.killAll(); app.quit() } }
      ])
      tray.setContextMenu(menu)
    }

    const runPoll = async (force = false): Promise<void> => {
      // "Poll now" (force) bypasses the paused flag; the interval tick does not.
      if ((paused && !force) || !store.config) return
      await dispatcher.poll()
      lastPoll = new Date().toLocaleTimeString()
      refreshMenu()
    }

    tray.setToolTip('SeniorDevWatch')
    if (!boot.ok) notify({ title: 'SeniorDevWatch: config error', body: boot.error })
    refreshMenu()

    const intervalMs = (store.config?.watch.intervalSeconds ?? 300) * 1000
    if (store.config?.watch.enabled) {
      void runPoll()
      setInterval(() => void runPoll(), intervalMs)
    }
  })

  app.on('window-all-closed', () => {}) // a trayless app must not quit on no-windows
  app.on('second-instance', () => {})
}
