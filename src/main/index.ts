import { app, BrowserWindow, session } from 'electron'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { defaultConfigDir } from './config/paths'
import { parseStartupArgs } from './cli/parse-args'
import { registerStartupIpc } from './ipc/startup-handlers'
import { ConfigStore } from './config/store'
import { registerIpc } from './ipc/handlers'
import { registerTerminalIpc } from './ipc/terminal-handlers'
import { registerYoloIpc } from './ipc/yolo-handlers'
import { registerPromptsIpc } from './ipc/prompts-handlers'
import { seedDefaultPrompts } from './prompts/defaults'
import { registerShellIpc } from './ipc/shell-handlers'
import { registerAppIpc } from './ipc/app-handlers'
import { registerConfigIpc } from './ipc/config-handlers'
import { registerPromptConfigIpc } from './ipc/prompt-config-handlers'
import { installMenu } from './menu'
import { nodePtySpawner } from './terminal/node-pty-spawner'
import { nodeHeadlessSpawner } from './headless/node-spawner'
import { systemResolveCommand } from './terminal/resolve-command'
import type { TerminalManager } from './terminal/manager'
import type { YoloRunner } from './headless/runner'

// Dev runs read package.json's `name` (seniordev-app) for app.getName();
// packaged builds get productName from electron-builder.yml. Pin it for both
// so About (app:info) always shows the product name.
app.setName('SeniorDev')

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

const store = new ConfigStore(resolveConfigPath())

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
let yolo: YoloRunner | null = null

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

  registerIpc(store.getTicket)
  registerShellIpc()
  const startup = parseStartupArgs(process.argv.slice(1), (p) => readFileSync(p, 'utf8'))
  for (const w of startup.warnings ?? []) console.error('[startup]', w)
  registerStartupIpc(startup)
  registerPromptsIpc(store.prompts)
  const getSender = (): Electron.WebContents | undefined =>
    BrowserWindow.getFocusedWindow()?.webContents ?? BrowserWindow.getAllWindows()[0]?.webContents
  terminals = registerTerminalIpc(getSender, nodePtySpawner, { source: store, resolveCommand: systemResolveCommand })
  yolo = registerYoloIpc(getSender, nodeHeadlessSpawner, { source: store, resolveCommand: systemResolveCommand })
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
})
app.on('window-all-closed', () => {
  terminals?.killAll()
  yolo?.killAll()
  if (process.platform !== 'darwin') app.quit()
})
