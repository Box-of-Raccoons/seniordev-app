import { app, Tray, Menu, Notification, nativeImage, shell, type MenuItemConstructorOptions } from 'electron'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { ConfigStore } from '../main/config/store'
import { defaultConfigDir } from '../main/config/paths'
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

// Launch the SeniorDev app on a ticket ("no invisible work" — the run shows in a
// visible tab). In dev, process.execPath is the electron binary and needs the app
// entry (out/main/index.js) as its first arg; in a packaged build the exe's
// default entry IS index.js, so no entry arg. The app is single-instance, so a
// second launch becomes a new orchestrator tab in the running app.
function launchApp(ticketKey: string): void {
  const entry = app.isPackaged ? [] : [join(__dirname, 'index.js')]
  spawn(process.execPath, [...entry, '--orchestrate', ticketKey, '--minimized'], {
    detached: true,
    stdio: 'ignore'
  }).unref()
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
      launch: (ticket: Ticket) => launchApp(ticket.key),
      state,
      notify,
      isAuto,
      now: () => new Date().toISOString()
    })

    const refreshMenu = (): void => {
      const pending = dispatcher.pendingApprovals()
      tray.setToolTip(pending.length ? `SeniorDevWatch — ${pending.length} awaiting approval` : 'SeniorDevWatch — idle')
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
        { label: `${dispatcher.pendingCount} awaiting approval`, enabled: false },
        ...approvals,
        { type: 'separator' },
        { label: 'Auto-dispatch', type: 'checkbox', checked: isAuto(), click: (i) => { state.setAutoMode(i.checked); refreshMenu() } },
        { label: paused ? 'Resume polling' : 'Pause polling', click: () => { paused = !paused; refreshMenu() } },
        { label: 'Poll now', click: () => void runPoll(true) },
        { type: 'separator' },
        { label: 'Open config', click: () => void shell.openPath(store.configPath) },
        { label: 'Quit', click: () => app.quit() }
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
