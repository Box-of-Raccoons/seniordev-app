import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { loadConfig } from './config/load'
import { JiraClient } from './jira/client'
import { registerIpc } from './ipc/handlers'

function resolveConfigPath(): string {
  return process.env.SENIORDEV_CONFIG ?? join(app.getPath('userData'), 'config.yaml')
}

function buildGetTicket(): (key: string) => Promise<import('../shared/types').Ticket> {
  try {
    const cfg = loadConfig(resolveConfigPath())
    const client = new JiraClient(cfg.jira)
    return (key) => client.fetchIssue(key)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return async () => {
      throw new Error(`Config not loaded (${resolveConfigPath()}): ${msg}`)
    }
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.mjs'), sandbox: false }
  })
  win.on('ready-to-show', () => win.show())
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  registerIpc(buildGetTicket())
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
