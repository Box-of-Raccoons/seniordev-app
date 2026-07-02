import { app, BrowserWindow, session } from 'electron'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { readFileSync } from 'node:fs'
import { parseStartupArgs } from './cli/parse-args'
import { registerStartupIpc } from './ipc/startup-handlers'
import { loadConfig } from './config/load'
import { JiraClient } from './jira/client'
import { registerIpc } from './ipc/handlers'
import { registerTerminalIpc } from './ipc/terminal-handlers'
import { registerPromptsIpc } from './ipc/prompts-handlers'
import { registerShellIpc } from './ipc/shell-handlers'
import { loadPrompts } from './prompts/library'
import { nodePtySpawner } from './terminal/node-pty-spawner'
import type { Config } from './config/schema'
import type { TerminalManager } from './terminal/manager'

function resolveConfigPath(): string {
  return process.env.SENIORDEV_CONFIG ?? join(app.getPath('userData'), 'config.yaml')
}

function resolvePromptsDir(cfg: Config): string {
  return cfg.promptsDir ?? join(homedir(), '.config', 'SeniorDev', 'prompts')
}

let loadedConfig: Config | null = null

function buildGetTicket(): (key: string) => Promise<import('../shared/types').Ticket> {
  try {
    const cfg = loadConfig(resolveConfigPath())
    loadedConfig = cfg
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
    // sandbox:false is required for the ESM (.mjs) preload — sandboxed preloads
    // must be CJS. Don't "fix" this to true without also converting the preload.
    webPreferences: { preload: join(__dirname, '../preload/index.mjs'), sandbox: false }
  })
  win.on('ready-to-show', () => win.show())
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

let terminals: TerminalManager | null = null

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

  registerIpc(buildGetTicket())
  registerShellIpc()
  registerStartupIpc(parseStartupArgs(process.argv.slice(1), (p) => readFileSync(p, 'utf8')))
  if (loadedConfig) {
    const cfg = loadedConfig
    const client = new JiraClient(cfg.jira)
    const prompts = loadPrompts(resolvePromptsDir(cfg))
    registerPromptsIpc(prompts)
    terminals = registerTerminalIpc(
      cfg,
      () => BrowserWindow.getFocusedWindow()?.webContents ?? BrowserWindow.getAllWindows()[0]?.webContents,
      nodePtySpawner,
      { getTicket: (key) => client.fetchIssue(key), prompts }
    )
  }

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => terminals?.killAll())
app.on('window-all-closed', () => {
  terminals?.killAll()
  if (process.platform !== 'darwin') app.quit()
})
