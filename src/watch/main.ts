import { app, Tray, Menu, Notification, nativeImage, shell } from 'electron'
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
function iconsDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'assets') : join(app.getAppPath(), 'assets')
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

    const idleIcon = nativeImage.createFromPath(join(iconsDir(), 'raccoon-asleep.png'))
    const busyIcon = nativeImage.createFromPath(join(iconsDir(), 'raccoon-hardhat.png'))
    const tray = new Tray(idleIcon)

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
        return new Promise((resolve) => {
          spawnResolvers.set(id, (r) => { spawnResolvers.delete(id); resolve(r) })
          yolo.start(id, {
            file: launch.file, args: launch.args, cwd: launch.cwd, prompt: launch.prompt,
            parser: createParser(launch.outputParser, launch.sessionIdPattern),
            patterns: buildForgePatterns(cfg), resolved: launch.resolved
          })
        })
      },
      state,
      notify,
      isAuto,
      now: () => new Date().toISOString()
    })

    const refreshMenu = (): void => {
      tray.setImage(dispatcher.inFlightCount > 0 ? busyIcon : idleIcon)
      const menu = Menu.buildFromTemplate([
        { label: `SeniorDevWatch — last poll ${lastPoll}`, enabled: false },
        { label: `${dispatcher.inFlightCount} running · ${dispatcher.pendingCount} awaiting approval`, enabled: false },
        { type: 'separator' },
        { label: 'Auto-dispatch', type: 'checkbox', checked: isAuto(), click: (i) => { state.setAutoMode(i.checked); refreshMenu() } },
        { label: paused ? 'Resume polling' : 'Pause polling', click: () => { paused = !paused; refreshMenu() } },
        { label: 'Poll now', click: () => void runPoll() },
        { type: 'separator' },
        { label: 'Open config', click: () => void shell.openPath(store.configPath) },
        { label: 'Quit', click: () => { yolo.killAll(); classifyEngine.killAll(); app.quit() } }
      ])
      tray.setContextMenu(menu)
    }

    const runPoll = async (): Promise<void> => {
      if (paused || !store.config) return
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
