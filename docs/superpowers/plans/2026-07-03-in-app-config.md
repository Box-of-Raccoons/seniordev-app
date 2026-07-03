# In-App Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the default Electron menu with File/Edit/Config/About; add in-app editors for `config.yaml` (validate-first save + live reload), the new `{{ticket.context}}` injection template, `yoloRecap`, and prebuilt-prompt CRUD; File → New Session resets the workbench; About shows name/version/credit.

**Architecture:** A mutable `ConfigStore` in main owns `{config, jiraClient, prompts[]}` and exposes `reload()`/`reloadPrompts()`; IPC registrations read the store at call time instead of closure-capturing config, so a save can hot-reload without touching running sessions. The native menu only sends `menu:action` IPC; all UI is renderer modals over the workbench. All file I/O (yaml, prompt .md files) stays in main behind validate-first, atomic-write handlers.

**Tech Stack:** Electron (main/preload/renderer), Vue 3, TypeScript, Zod, `yaml` package (Document API for comment-preserving recap edits), vitest + @vue/test-utils. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-03-in-app-config-design.md`.

## Global Constraints

- Branch: all work on `feature/in-app-config` in `C:\Users\hardy\code\seniordev-app`. Verify with `git -C C:\Users\hardy\code\seniordev-app branch --show-current` before every commit.
- Commit messages: NO `Co-Authored-By` or any AI-attribution trailer.
- Gates: `pnpm typecheck` and `pnpm test` pass at the end of every task.
- Reload applies to NEW work only — never touch a running PTY/YOLO session on reload.
- A failed reload keeps the previous good config (`keep-last-good`); a bad save writes nothing (validate-first); all file writes are atomic (temp + rename).
- The renderer never touches the filesystem; every file op is a main-side IPC handler.
- Prompt filenames starting with `_` are reserved (never listed as launchable prompts).
- The About credit line is exactly: `By Box of Raccoons LLC, 2026`.
- `package.json` / `pnpm-lock.yaml` / `jira-check.mjs` have unrelated uncommitted changes — never stage them.
- TDD: failing test first in every task.

---

### Task 0: Record baseline

- [ ] **Step 1: Capture starting gate numbers**

Run: `cd C:\Users\hardy\code\seniordev-app && pnpm typecheck && pnpm test`
Record: exact pass/fail counts (expected: typecheck clean, 159 passing). All later deltas diff against this.

---

### Task 1: parseConfig extraction + ConfigStore

**Files:**
- Modify: `src/main/config/load.ts`
- Create: `src/main/config/store.ts`
- Test: `src/main/config/store.test.ts`, extend `src/main/config/load.test.ts`

**Interfaces (produces):**

```ts
// load.ts
export function parseConfig(raw: string): Config     // yaml parse + presets merge + Zod; throws on invalid
export function loadConfig(path: string): Config     // unchanged behavior: parseConfig(readFileSync(path,'utf8'))

// store.ts
export interface ConfigSource {
  readonly config: Config | null
  readonly loadError: string | null
  readonly prompts: PromptTemplate[]
  getTicket(key: string): Promise<Ticket>
}
export function requireConfig(src: ConfigSource): Config   // throws "Config not loaded: <loadError>" when null
export class ConfigStore implements ConfigSource {
  constructor(readonly configPath: string)
  config: Config | null
  jiraClient: JiraClient | null
  readonly prompts: PromptTemplate[]        // SAME array instance forever
  loadError: string | null
  promptsDir(): string                      // config.promptsDir ?? join(defaultConfigDir(),'prompts')
  reload(): { ok: true } | { ok: false; error: string }
  reloadPrompts(): void
  getTicket: (key: string) => Promise<Ticket>   // arrow property (safe to pass detached)
}
```

- [ ] **Step 1: Write failing tests**

Add to `src/main/config/load.test.ts` (reuse its existing `tmpConfig`/`MINIMAL` helpers):

```ts
import { parseConfig } from './load'

describe('parseConfig', () => {
  it('parses raw yaml text with presets merged', () => {
    const cfg = parseConfig(MINIMAL)
    expect(cfg.cliTools.claude.command).toBe('claude')
  })
  it('throws a Zod error naming the bad path', () => {
    expect(() => parseConfig('jira:\n  baseUrl: not-a-url\n  email: a@b.co\n  apiToken: t\n')).toThrow(/baseUrl/)
  })
  it('throws on YAML syntax errors', () => {
    expect(() => parseConfig('jira: [unclosed')).toThrow()
  })
})
```

Create `src/main/config/store.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigStore, requireConfig } from './store'

const MINIMAL = 'jira:\n  baseUrl: https://x.atlassian.net\n  email: a@b.co\n  apiToken: t\n'

function tmpSetup(yaml: string): { store: ConfigStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sd-store-'))
  const cfgPath = join(dir, 'config.yaml')
  writeFileSync(cfgPath, yaml + `promptsDir: ${JSON.stringify(join(dir, 'prompts'))}\n`, 'utf8')
  return { store: new ConfigStore(cfgPath), dir }
}

describe('ConfigStore', () => {
  it('reload loads config and builds the jira client', () => {
    const { store } = tmpSetup(MINIMAL)
    expect(store.reload()).toEqual({ ok: true })
    expect(store.config?.jira.email).toBe('a@b.co')
    expect(store.jiraClient).not.toBeNull()
    expect(store.loadError).toBeNull()
  })
  it('reload failure keeps the last good config', () => {
    const { store } = tmpSetup(MINIMAL)
    store.reload()
    writeFileSync(store.configPath, 'jira: [broken', 'utf8')
    const res = store.reload()
    expect(res.ok).toBe(false)
    expect(store.config?.jira.email).toBe('a@b.co') // last-good preserved
    expect(store.loadError).toBeNull()              // loadError only set when NO good config exists
  })
  it('boot failure records loadError and getTicket throws it', async () => {
    const store = new ConfigStore(join(tmpdir(), 'sd-none', 'nope.yaml'))
    const res = store.reload()
    expect(res.ok).toBe(false)
    expect(store.config).toBeNull()
    expect(store.loadError).toBeTruthy()
    await expect(store.getTicket('P-1')).rejects.toThrow(/Config not loaded/)
  })
  it('reloadPrompts mutates the SAME array instance in place', () => {
    const { store, dir } = tmpSetup(MINIMAL)
    store.reload()
    const ref = store.prompts
    mkdirSync(join(dir, 'prompts'), { recursive: true })
    writeFileSync(join(dir, 'prompts', 'fix.md'), '---\nname: fix\ndescription: d\n---\nbody', 'utf8')
    store.reloadPrompts()
    expect(store.prompts).toBe(ref)                 // identity stable — handlers hold this reference
    expect(ref.map((p) => p.name)).toEqual(['fix'])
  })
  it('requireConfig throws with the load error when config is null', () => {
    const store = new ConfigStore('C:/definitely/missing.yaml')
    store.reload()
    expect(() => requireConfig(store)).toThrow(/Config not loaded/)
    const { store: good } = tmpSetup(MINIMAL)
    good.reload()
    expect(requireConfig(good).jira.email).toBe('a@b.co')
  })
})
```

- [ ] **Step 2: Run to verify failure** — `pnpm test -- store` → FAIL (module missing); `pnpm test -- load` → FAIL (parseConfig not exported).
- [ ] **Step 3: Implement**

`src/main/config/load.ts` — split the body (keep `mergeByKey` and its comment untouched):

```ts
export function parseConfig(rawText: string): Config {
  const raw = (parse(rawText) ?? {}) as Dict
  raw.cliTools = mergeByKey(CLI_PRESETS as unknown as Record<string, Dict>, raw.cliTools)
  raw.forges = mergeByKey(FORGE_PRESETS as unknown as Record<string, Dict>, raw.forges)
  return ConfigSchema.parse(raw)
}

export function loadConfig(path: string): Config {
  return parseConfig(readFileSync(path, 'utf8'))
}
```

`src/main/config/store.ts`:

```ts
import { join } from 'node:path'
import type { Config } from './schema'
import type { Ticket } from '../../shared/types'
import { loadConfig } from './load'
import { defaultConfigDir } from './paths'
import { loadPrompts, type PromptTemplate } from '../prompts/library'
import { JiraClient } from '../jira/client'

// The minimal read surface IPC handlers depend on — lets tests hand in a plain
// object instead of a real store.
export interface ConfigSource {
  readonly config: Config | null
  readonly loadError: string | null
  readonly prompts: PromptTemplate[]
  getTicket(key: string): Promise<Ticket>
}

export function requireConfig(src: ConfigSource): Config {
  if (!src.config) throw new Error(`Config not loaded: ${src.loadError ?? 'unknown error'}`)
  return src.config
}

// Mutable holder for everything derived from config.yaml. Handlers read it at
// call time, so reload() takes effect for NEW work without re-registration;
// running sessions copied their launch at spawn and are never touched.
export class ConfigStore implements ConfigSource {
  config: Config | null = null
  jiraClient: JiraClient | null = null
  readonly prompts: PromptTemplate[] = []
  loadError: string | null = null

  constructor(readonly configPath: string) {}

  promptsDir(): string {
    return this.config?.promptsDir ?? join(defaultConfigDir(), 'prompts')
  }

  reload(): { ok: true } | { ok: false; error: string } {
    try {
      const cfg = loadConfig(this.configPath)
      this.config = cfg
      this.jiraClient = new JiraClient(cfg.jira)
      this.loadError = null
      this.reloadPrompts()
      return { ok: true }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      // Keep last-good: only surface a boot-level error when we never loaded.
      if (!this.config) this.loadError = error
      return { ok: false, error }
    }
  }

  reloadPrompts(): void {
    if (!this.config) return
    this.prompts.splice(0, this.prompts.length, ...loadPrompts(this.promptsDir()))
  }

  getTicket = async (key: string): Promise<Ticket> => {
    if (!this.jiraClient) {
      throw new Error(`Config not loaded (${this.configPath}): ${this.loadError ?? 'unknown error'}`)
    }
    return this.jiraClient.fetchIssue(key)
  }
}
```

- [ ] **Step 4: Run tests** — `pnpm test -- store && pnpm test -- load` → PASS.
- [ ] **Step 5: Gate + commit**

```bash
pnpm typecheck && pnpm test
git add src/main/config/load.ts src/main/config/load.test.ts src/main/config/store.ts src/main/config/store.test.ts
git commit -m "feat(config): parseConfig + mutable ConfigStore with keep-last-good reload"
```

---

### Task 2: Handlers read the store; main boots config-less

**Files:**
- Modify: `src/main/ipc/terminal-handlers.ts` (+ `terminal-handlers.test.ts`)
- Modify: `src/main/ipc/yolo-handlers.ts` (+ `yolo-handlers.test.ts`)
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `ConfigSource`, `requireConfig`, `ConfigStore` (Task 1).
- Produces (later tasks rely on these exact signatures):

```ts
export interface TerminalDeps {
  source: ConfigSource
  resolveCommand?: (command: string) => ResolvedCommand | undefined
}
registerTerminalIpc(getSender: () => Electron.WebContents | undefined, spawner: PtySpawner, deps: TerminalDeps): TerminalManager
registerYoloIpc(getSender: () => Electron.WebContents | undefined, spawner: HeadlessSpawner, deps: TerminalDeps): YoloRunner
```

(The `config: Config` first parameter is REMOVED from both. `resolveExpandedPrompt`'s `PromptDeps` is `{getTicket, prompts}` — `ConfigSource` satisfies it structurally, so `resolve-prompt.ts` is untouched.)

- [ ] **Step 1: Adjust the failing tests** — in both test files, replace the `(config, getSender, spawner, deps)` call shape with the new one; the fake source is a plain object:

```ts
const source = { config, loadError: null, prompts: [] as PromptTemplate[], getTicket: vi.fn() }
// registerTerminalIpc(getSender, spawner, { source, resolveCommand })
// registerYoloIpc(getSender, spawner, { source })
```

Add ONE new case to each file:

```ts
// terminal-handlers.test.ts
it('spawn returns a clear error when config is not loaded', async () => {
  const source = { config: null, loadError: 'boom', prompts: [], getTicket: vi.fn() }
  // register with this source, invoke the captured TERM.spawn handler:
  // expect result { ok: false, error: expect.stringMatching(/Config not loaded: boom/) }
})
// yolo-handlers.test.ts
it('caps reports unavailable and start errors cleanly when config is not loaded', async () => {
  // caps handler → { available: false }
  // YOLO.start with a prompt → { ok: false, error: /Config not loaded/ }
})
```

(Expand the comments into real assertions with each file's existing electron mock.)

- [ ] **Step 2: Run to verify failure** — `pnpm test -- terminal-handlers && pnpm test -- yolo-handlers` → FAIL (signature mismatch).
- [ ] **Step 3: Implement `terminal-handlers.ts`** — replace the signature and config uses:

```ts
import { requireConfig, type ConfigSource } from '../config/store'

export interface TerminalDeps {
  source: ConfigSource
  resolveCommand?: (command: string) => ResolvedCommand | undefined
}

export function registerTerminalIpc(
  getSender: () => Electron.WebContents | undefined,
  spawner: PtySpawner,
  deps: TerminalDeps
): TerminalManager {
```

Inside the `TERM.spawn` handler's try block (config read at call time — this is what makes reload live):

```ts
      const config = requireConfig(deps.source)
      const expanded = await resolveExpandedPrompt(config, deps.source, req)
      const launch = buildInteractiveLaunch(config, req, expanded, deps.resolveCommand)
```

Everything else (prompt-delivery machinery, manager wiring) unchanged.

- [ ] **Step 4: Implement `yolo-handlers.ts`** — same shape:

```ts
export function registerYoloIpc(
  getSender: () => Electron.WebContents | undefined,
  spawner: HeadlessSpawner,
  deps: TerminalDeps
): YoloRunner {
```

`YOLO.start` try block starts with `const config = requireConfig(deps.source)`, then uses `config` for `resolveExpandedPrompt(config, deps.source, req)`, `buildHeadlessLaunch(config, req, ...)`, `buildForgePatterns(config)`. Caps handler becomes null-safe:

```ts
  ipcMain.handle(YOLO.caps, (): YoloCaps => {
    const c = deps.source.config
    return { available: Boolean(c && c.cliTools[c.defaultTool]?.headless) }
  })
```

(`import type { TerminalDeps } from './terminal-handlers'` stays.)

- [ ] **Step 5: Rewire `main/index.ts`** — delete `buildGetTicket` and the `loadedConfig` global; build one store; register everything UNCONDITIONALLY (the `if (loadedConfig)` block goes away — this is what lets a user fix a broken config in-app):

```ts
import { ConfigStore } from './config/store'
// (drop the now-unused loadConfig/JiraClient/Config imports; keep resolveConfigPath; delete resolvePromptsDir — store owns it)

const store = new ConfigStore(resolveConfigPath())

app.whenReady().then(() => {
  // ... CSP block unchanged ...
  const boot = store.reload()
  if (!boot.ok) console.error('[config]', boot.error)

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

  createWindow()
  // ... activate handler unchanged ...
})
```

(`registerPromptsIpc` already maps inside the handle callback, so passing the live `store.prompts` array is enough — no change to `prompts-handlers.ts`.)

- [ ] **Step 6: Gate + commit**

Run: `pnpm typecheck && pnpm test`
Expected: PASS; delta vs baseline = +2 (the two new config-less cases).

```bash
git add src/main/ipc/terminal-handlers.ts src/main/ipc/terminal-handlers.test.ts src/main/ipc/yolo-handlers.ts src/main/ipc/yolo-handlers.test.ts src/main/index.ts
git commit -m "feat(config): handlers read ConfigStore at call time; app boots config-less"
```

---

### Task 3: Native menu + app:info

**Files:**
- Create: `src/main/menu.ts`
- Create: `src/main/ipc/app-handlers.ts`
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`
- Test: `src/main/menu.test.ts`

**Interfaces (produces):**

```ts
// shared/ipc.ts
export type MenuAction = 'new-session' | 'app-config' | 'prompt-config' | 'about'
export const MENU = { action: 'menu:action' } as const
export interface AppInfo { name: string; version: string }
export const APP = { info: 'app:info' } as const
// menu.ts
export function menuTemplate(send: (action: MenuAction) => void): MenuItemConstructorOptions[]
export function installMenu(getSender: () => Electron.WebContents | undefined): void
// app-handlers.ts
export function registerAppIpc(): void
// preload api additions
onMenuAction(cb: (action: MenuAction) => void): () => void
getAppInfo(): Promise<AppInfo>
```

- [ ] **Step 1: Write failing test** (`src/main/menu.test.ts`; mock electron like the handler tests do — only `Menu` and `app` are touched by the module under test, and `menuTemplate` itself never calls them):

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getName: () => 'SeniorDev', getVersion: () => '0.0.0' },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() }
}))

import { menuTemplate } from './menu'
import type { MenuAction } from '../shared/ipc'

type Item = { label?: string; role?: string; accelerator?: string; click?: () => void; submenu?: Item[]; type?: string }

describe('menuTemplate', () => {
  const sent: MenuAction[] = []
  const tpl = menuTemplate((a) => sent.push(a)) as Item[]

  it('has exactly File, Edit(role), Config, About', () => {
    expect(tpl.map((m) => m.label ?? m.role)).toEqual(['File', 'editMenu', 'Config', 'About'])
  })
  it('File: New Session (CmdOrCtrl+N) fires new-session; Exit is the quit role labeled Exit', () => {
    const file = tpl[0].submenu!
    expect(file[0].label).toBe('New Session')
    expect(file[0].accelerator).toBe('CmdOrCtrl+N')
    file[0].click!()
    expect(sent).toContain('new-session')
    expect(file[1].type).toBe('separator')
    expect(file[2].role).toBe('quit')
    expect(file[2].label).toBe('Exit')
  })
  it('Config items fire app-config and prompt-config', () => {
    const cfg = tpl[2].submenu!
    cfg[0].click!()
    cfg[1].click!()
    expect(sent).toEqual(expect.arrayContaining(['app-config', 'prompt-config']))
  })
  it('About fires about', () => {
    tpl[3].submenu![0].click!()
    expect(sent).toContain('about')
  })
})
```

- [ ] **Step 2: Run to verify failure** — `pnpm test -- menu` → FAIL.
- [ ] **Step 3: Implement**

`src/shared/ipc.ts` — append:

```ts
export type MenuAction = 'new-session' | 'app-config' | 'prompt-config' | 'about'
export const MENU = { action: 'menu:action' } as const

export interface AppInfo { name: string; version: string }
export const APP = { info: 'app:info' } as const
```

`src/main/menu.ts`:

```ts
import { Menu, type MenuItemConstructorOptions } from 'electron'
import { MENU, type MenuAction } from '../shared/ipc'

// The menu is deliberately dumb: every item only sends one IPC action to the
// focused window; the renderer owns all behavior (modals, reset flow).
export function menuTemplate(send: (action: MenuAction) => void): MenuItemConstructorOptions[] {
  return [
    {
      label: 'File',
      submenu: [
        { label: 'New Session', accelerator: 'CmdOrCtrl+N', click: () => send('new-session') },
        { type: 'separator' },
        // Without an Edit role-menu below, clipboard accelerators die on macOS.
        { role: 'quit', label: 'Exit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'Config',
      submenu: [
        { label: 'App Config…', click: () => send('app-config') },
        { label: 'Prompt Config…', click: () => send('prompt-config') }
      ]
    },
    {
      label: 'About',
      submenu: [{ label: 'About SeniorDev', click: () => send('about') }]
    }
  ]
}

export function installMenu(getSender: () => Electron.WebContents | undefined): void {
  const send = (action: MenuAction): void => getSender()?.send(MENU.action, action)
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(send)))
}
```

`src/main/ipc/app-handlers.ts`:

```ts
import { app, ipcMain } from 'electron'
import { APP, type AppInfo } from '../../shared/ipc'

export function registerAppIpc(): void {
  ipcMain.handle(APP.info, (): AppInfo => ({ name: app.getName(), version: app.getVersion() }))
}
```

`src/preload/index.ts` — extend imports (`MENU, APP, type MenuAction, type AppInfo`) and add to `api`:

```ts
  onMenuAction: (cb: (action: MenuAction) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, action: MenuAction): void => cb(action)
    ipcRenderer.on(MENU.action, listener)
    return () => ipcRenderer.off(MENU.action, listener)
  },
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(APP.info),
```

`src/main/index.ts` — inside `app.whenReady().then`, after the yolo registration: `registerAppIpc()` and `installMenu(getSender)` (imports: `./menu`, `./ipc/app-handlers`).

- [ ] **Step 4: Run tests** — `pnpm test -- menu` → PASS; `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/main/menu.ts src/main/menu.test.ts src/main/ipc/app-handlers.ts src/shared/ipc.ts src/preload/index.ts src/main/index.ts
git commit -m "feat(menu): native File/Edit/Config/About menu + app:info"
```

---

### Task 4: Config read/save IPC

**Files:**
- Create: `src/main/ipc/config-handlers.ts`
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`
- Test: `src/main/ipc/config-handlers.test.ts`

**Interfaces (produces):**

```ts
// shared/ipc.ts
export type ConfigReadResult = { ok: true; text: string; path: string; isTemplate?: boolean } | { ok: false; error: string }
export type SaveResult = { ok: true } | { ok: false; error: string }
export interface RecapInfo { text: string; isDefault: boolean }
export const CONFIG = {
  read: 'config:read', save: 'config:save', changed: 'config:changed',
  readRecap: 'config:readRecap', saveRecap: 'config:saveRecap'
} as const
// config-handlers.ts
export const STARTER_CONFIG: string
export function writeFileAtomic(path: string, text: string): void
export function registerConfigIpc(store: ConfigStore, getSender: () => Electron.WebContents | undefined): void
// preload api additions
readConfig(): Promise<ConfigReadResult>
saveConfig(text: string): Promise<SaveResult>
onConfigChanged(cb: () => void): () => void
readRecap(): Promise<RecapInfo>
saveRecap(text: string): Promise<SaveResult>
```

(`readRecap`/`saveRecap` handlers are registered here; the Prompt Config UI consumes them in Task 9.)

- [ ] **Step 1: Write failing tests** (`src/main/ipc/config-handlers.test.ts` — mirror the electron `ipcMain` mock from `terminal-handlers.test.ts`; the fake sender is `{ send: vi.fn() }`; use a real `ConfigStore` on a temp dir):

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// ... electron ipcMain mock capturing handle/on registrations, as in terminal-handlers.test.ts ...
import { registerConfigIpc, STARTER_CONFIG, writeFileAtomic } from './config-handlers'
import { ConfigStore } from '../config/store'
import { CONFIG } from '../../shared/ipc'
import { DEFAULT_YOLO_RECAP } from '../config/presets'

const MINIMAL = 'jira:\n  baseUrl: https://x.atlassian.net\n  email: a@b.co\n  apiToken: t\n'

// helper: fresh temp store (+ optionally pre-written config), registered handlers, captured sender

describe('config handlers', () => {
  it('read returns the raw file text and path', async () => {
    // write MINIMAL + '# a comment\n' to temp config; invoke CONFIG.read
    // expect { ok: true, text: containing '# a comment', path: cfgPath } and no isTemplate
  })
  it('read returns STARTER_CONFIG with isTemplate when the file is missing', async () => {
    // store on a non-existent path → { ok: true, text: STARTER_CONFIG, isTemplate: true }
  })
  it('save validates first: invalid text writes nothing and returns the error', async () => {
    // pre-write MINIMAL; invoke CONFIG.save with 'jira: [broken'
    // expect ok:false, error truthy; file on disk still equals MINIMAL; sender.send NOT called
  })
  it('save writes, reloads the store, and broadcasts config:changed', async () => {
    // invoke CONFIG.save with MINIMAL + 'defaultTool: codex\n'
    // expect ok:true; readFileSync(cfgPath) contains 'defaultTool: codex';
    // store.config?.defaultTool === 'codex'; sender.send called with CONFIG.changed
  })
  it('readRecap reports the built-in default until config overrides it', async () => {
    // with MINIMAL: → { text: DEFAULT_YOLO_RECAP, isDefault: true }
    // save MINIMAL + 'yoloRecap: custom\n' → readRecap → { text: 'custom', isDefault: false }
  })
  it('saveRecap edits ONLY the yoloRecap key and preserves comments elsewhere', async () => {
    // pre-write '# keep me\n' + MINIMAL; invoke CONFIG.saveRecap with 'my recap'
    // file text still contains '# keep me'; store.config?.yoloRecap === 'my recap'
  })
  it('saveRecap with the default text deletes the key', async () => {
    // pre-write MINIMAL + 'yoloRecap: custom\n'; saveRecap(DEFAULT_YOLO_RECAP)
    // file no longer contains 'yoloRecap'; readRecap isDefault true
  })
  it('writeFileAtomic creates parent dirs and leaves no .tmp behind', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sd-atomic-'))
    const p = join(dir, 'deep', 'file.txt')
    writeFileAtomic(p, 'x')
    expect(readFileSync(p, 'utf8')).toBe('x')
    expect(existsSync(p + '.tmp')).toBe(false)
  })
})
```

(Expand each comment block into real code — the described inputs/expectations are normative.)

- [ ] **Step 2: Run to verify failure** — `pnpm test -- config-handlers` → FAIL.
- [ ] **Step 3: Implement**

`src/shared/ipc.ts` — append the `ConfigReadResult`/`SaveResult`/`RecapInfo`/`CONFIG` block exactly as in Interfaces.

`src/main/ipc/config-handlers.ts`:

```ts
import { ipcMain } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseDocument } from 'yaml'
import { CONFIG, type ConfigReadResult, type RecapInfo, type SaveResult } from '../../shared/ipc'
import { parseConfig } from '../config/load'
import { DEFAULT_YOLO_RECAP } from '../config/presets'
import type { ConfigStore } from '../config/store'

// Shown when no config.yaml exists yet — mirrors config.example.yaml, but lives
// in code so the packaged app doesn't need to locate the example on disk.
export const STARTER_CONFIG = `# SeniorDev config
jira:
  baseUrl: https://yoursite.atlassian.net
  email: you@company.com
  apiToken: paste-token-from-id.atlassian.net

# Everything below is optional; presets for claude/codex + github/gitlab apply automatically.
# ticketContext: both        # key-only | both
# defaultTool: claude
# defaultForge: github
# repos:
#   - key: PROJ
#     path: C:/Users/you/code/backend
#     branchPrefix: feature/
#     forge: github
`

export function writeFileAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, path)
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function registerConfigIpc(
  store: ConfigStore,
  getSender: () => Electron.WebContents | undefined
): void {
  // Validate → write → reload → broadcast. Shared by save and saveRecap so a
  // bad edit can never reach disk and a good one always goes live.
  function commit(text: string): SaveResult {
    parseConfig(text) // throws with YAML line numbers or Zod paths
    writeFileAtomic(store.configPath, text)
    const res = store.reload()
    if (!res.ok) return res
    getSender()?.send(CONFIG.changed)
    return { ok: true }
  }

  ipcMain.handle(CONFIG.read, (): ConfigReadResult => {
    try {
      if (!existsSync(store.configPath)) {
        return { ok: true, text: STARTER_CONFIG, path: store.configPath, isTemplate: true }
      }
      return { ok: true, text: readFileSync(store.configPath, 'utf8'), path: store.configPath }
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  })

  ipcMain.handle(CONFIG.save, (_e, text: string): SaveResult => {
    try {
      return commit(text)
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  })

  ipcMain.handle(CONFIG.readRecap, (): RecapInfo => {
    const v = store.config?.yoloRecap
    return { text: v ?? DEFAULT_YOLO_RECAP, isDefault: v === undefined }
  })

  ipcMain.handle(CONFIG.saveRecap, (_e, text: string): SaveResult => {
    try {
      if (!existsSync(store.configPath)) {
        return { ok: false, error: 'No config file yet — save App Config first' }
      }
      // Targeted document edit: only the yoloRecap key changes; comments and
      // formatting everywhere else survive byte-for-byte.
      const doc = parseDocument(readFileSync(store.configPath, 'utf8'))
      if (text.trim() === DEFAULT_YOLO_RECAP.trim()) doc.delete('yoloRecap')
      else doc.set('yoloRecap', text)
      return commit(doc.toString())
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  })
}
```

`src/preload/index.ts` — add the five entries per Interfaces (same listener pattern as `onYoloLog` for `onConfigChanged`).

`src/main/index.ts` — after `registerAppIpc()`: `registerConfigIpc(store, getSender)`.

- [ ] **Step 4: Run tests** — `pnpm test -- config-handlers` → PASS.
- [ ] **Step 5: Gate + commit**

```bash
pnpm typecheck && pnpm test
git add src/main/ipc/config-handlers.ts src/main/ipc/config-handlers.test.ts src/shared/ipc.ts src/preload/index.ts src/main/index.ts
git commit -m "feat(config): read/save IPC with validate-first atomic writes + recap document edits"
```

---

### Task 5: Prompt files module + `{{ticket.context}}` expansion

**Files:**
- Create: `src/main/prompts/files.ts`
- Modify: `src/main/prompts/library.ts` (export `parseFrontmatter`; exclude `_`-prefixed files)
- Modify: `src/main/prompts/expand.ts` (+ `expand.test.ts`)
- Modify: `src/main/ipc/resolve-prompt.ts`
- Modify: `src/main/config/store.ts` (add `contextTemplate`)
- Test: `src/main/prompts/files.test.ts`, extend `src/main/prompts/library.test.ts`

**Interfaces (produces):**

```ts
// files.ts
export const CONTEXT_FILE = '_ticket-context.md'
export const DEFAULT_TICKET_CONTEXT: string
export function readPromptFile(dir: string, name: string): string
export function writePromptFile(dir: string, name: string, text: string): void   // throws on bad frontmatter / name collision
export function createPromptFile(dir: string, name: string): string              // returns the skeleton it wrote; throws if exists
export function deletePromptFile(dir: string, name: string): void
export function readContextFile(dir: string): string                             // file text, or DEFAULT_TICKET_CONTEXT
export function writeContextFile(dir: string, text: string): void
// library.ts
export function parseFrontmatter(raw: string, fallbackName: string): PromptTemplate  // (now exported)
// expand.ts — expandPrompt ctx gains optional contextTemplate
expandPrompt(body: string, ctx: { ticket: PromptTicket; forge: {...}; contextTemplate?: string }): string
// resolve-prompt.ts — PromptDeps gains optional contextTemplate
export interface PromptDeps { getTicket(...); prompts: PromptTemplate[]; contextTemplate?: () => string }
// store.ts — ConfigSource + ConfigStore gain
contextTemplate(): string   // readContextFile(promptsDir()); on ConfigSource too (arrow property on the class)
```

- [ ] **Step 1: Write failing tests**

Add to `src/main/prompts/expand.test.ts` (file exists — extend it):

```ts
  it('expands {{ticket.context}} from the context template (one level)', () => {
    const out = expandPrompt('Do it.\n\n{{ticket.context}}', {
      ticket: { ...ticketFixture, key: 'P-1', summary: 'S' },
      forge: { prCommand: 'gh pr create', term: 'PR' },
      contextTemplate: 'Ticket {{ticket.key}}: {{ticket.summary}}'
    })
    expect(out).toBe('Do it.\n\nTicket P-1: S')
  })
  it('a {{ticket.context}} inside the template itself stays literal (no loop)', () => {
    const out = expandPrompt('{{ticket.context}}', {
      ticket: { ...ticketFixture, key: 'P-1' },
      forge: { prCommand: '', term: 'PR' },
      contextTemplate: 'K={{ticket.key}} SELF={{ticket.context}}'
    })
    expect(out).toBe('K=P-1 SELF={{ticket.context}}')
  })
  it('without a contextTemplate, {{ticket.context}} stays literal', () => {
    const out = expandPrompt('{{ticket.context}}', { ticket: ticketFixture, forge: { prCommand: '', term: 'PR' } })
    expect(out).toBe('{{ticket.context}}')
  })
```

(Use the file's existing ticket fixture/helper for `ticketFixture` — read the file first.)

Create `src/main/prompts/files.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CONTEXT_FILE, DEFAULT_TICKET_CONTEXT,
  createPromptFile, deletePromptFile, readContextFile, readPromptFile, writeContextFile, writePromptFile
} from './files'
import { loadPrompts } from './library'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'sd-prompts-')) })

describe('prompt files', () => {
  it('create writes a skeleton with frontmatter and returns it', () => {
    const text = createPromptFile(dir, 'fix-bug')
    expect(text).toContain('name: fix-bug')
    expect(readFileSync(join(dir, 'fix-bug.md'), 'utf8')).toBe(text)
  })
  it('create refuses an existing name', () => {
    createPromptFile(dir, 'fix-bug')
    expect(() => createPromptFile(dir, 'fix-bug')).toThrow(/already exists/)
  })
  it('rejects unsafe names (path separators, leading underscore/dot)', () => {
    for (const bad of ['../evil', 'a/b', '_reserved', '.hidden', ''])
      expect(() => createPromptFile(dir, bad)).toThrow(/Invalid prompt name/)
  })
  it('write validates frontmatter parses and effective-name collisions with OTHER files', () => {
    createPromptFile(dir, 'one')
    createPromptFile(dir, 'two')
    // renaming 'two' (via frontmatter) to collide with 'one' must throw:
    expect(() => writePromptFile(dir, 'two', '---\nname: one\ndescription: d\n---\nbody')).toThrow(/collides/)
    // same-file rename to a fresh name is fine:
    writePromptFile(dir, 'two', '---\nname: two-renamed\ndescription: d\n---\nbody')
    expect(readPromptFile(dir, 'two')).toContain('two-renamed')
  })
  it('delete removes the file', () => {
    createPromptFile(dir, 'gone')
    deletePromptFile(dir, 'gone')
    expect(existsSync(join(dir, 'gone.md'))).toBe(false)
  })
  it('context read falls back to the default; write round-trips', () => {
    expect(readContextFile(dir)).toBe(DEFAULT_TICKET_CONTEXT)
    writeContextFile(dir, 'custom {{ticket.key}}')
    expect(readContextFile(dir)).toBe('custom {{ticket.key}}')
    expect(existsSync(join(dir, CONTEXT_FILE))).toBe(true)
  })
  it('loadPrompts never lists _-prefixed files', () => {
    createPromptFile(dir, 'real')
    writeContextFile(dir, 'ctx')
    expect(loadPrompts(dir).map((p) => p.name)).toEqual(['real'])
  })
})
```

Add to `src/main/prompts/library.test.ts`: one case asserting `parseFrontmatter` is importable and parses (it becomes exported).

- [ ] **Step 2: Run to verify failure** — `pnpm test -- files && pnpm test -- expand` → FAIL.
- [ ] **Step 3: Implement**

`src/main/prompts/library.ts` — change `function parseFrontmatter` to `export function parseFrontmatter`; in `loadPrompts`, extend the filter:

```ts
    .filter((f) => f.toLowerCase().endsWith('.md') && !f.startsWith('_'))
```

`src/main/prompts/files.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFrontmatter } from './library'

export const CONTEXT_FILE = '_ticket-context.md'

// What {{ticket.context}} expands to until the user edits it — reproduces the
// de-facto layout the shipped example prompts used.
export const DEFAULT_TICKET_CONTEXT = `Work Jira ticket {{ticket.key}}: "{{ticket.summary}}"

{{ticket.description}}

Acceptance criteria:
{{ticket.acceptanceCriteria}}`

// Filename-safe, no leading underscore (reserved for specials) or dot.
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function assertName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new Error(`Invalid prompt name: "${name}" (letters/digits/._- only; must not start with _ or .)`)
  }
}

function fileOf(dir: string, name: string): string {
  return join(dir, `${name}.md`)
}

function writeAtomic(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, path)
}

export function readPromptFile(dir: string, name: string): string {
  assertName(name)
  return readFileSync(fileOf(dir, name), 'utf8')
}

export function writePromptFile(dir: string, name: string, text: string): void {
  assertName(name)
  const effective = parseFrontmatter(text, name).name
  // The effective name (frontmatter name ?? filename) must not collide with
  // any OTHER file's effective name — findPrompt() resolves by that name.
  for (const f of readdirSync(dir)) {
    if (!f.toLowerCase().endsWith('.md') || f.startsWith('_') || f === `${name}.md`) continue
    const other = parseFrontmatter(readFileSync(join(dir, f), 'utf8'), f.replace(/\.md$/i, ''))
    if (other.name === effective) throw new Error(`Prompt name "${effective}" collides with ${f}`)
  }
  writeAtomic(fileOf(dir, name), text)
}

export function createPromptFile(dir: string, name: string): string {
  assertName(name)
  if (existsSync(fileOf(dir, name))) throw new Error(`Prompt "${name}" already exists`)
  const skeleton = `---
name: ${name}
description:
---

Work Jira ticket {{ticket.key}}.

{{ticket.context}}
`
  writeAtomic(fileOf(dir, name), skeleton)
  return skeleton
}

export function deletePromptFile(dir: string, name: string): void {
  assertName(name)
  unlinkSync(fileOf(dir, name))
}

export function readContextFile(dir: string): string {
  const p = join(dir, CONTEXT_FILE)
  return existsSync(p) ? readFileSync(p, 'utf8') : DEFAULT_TICKET_CONTEXT
}

export function writeContextFile(dir: string, text: string): void {
  writeAtomic(join(dir, CONTEXT_FILE), text)
}
```

`src/main/prompts/expand.ts` — replace the return of `expandPrompt`:

```ts
export function expandPrompt(
  body: string,
  ctx: { ticket: PromptTicket; forge: { prCommand: string; term: string }; contextTemplate?: string }
): string {
  const map: Record<string, string> = {
    // ... existing nine entries unchanged ...
  }
  const fill = (s: string): string =>
    s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, key: string) => (key in map ? map[key] : m))
  // One-level expansion: the template's own {{ticket.*}} fields are filled, but
  // 'ticket.context' is not yet in the map, so a self-reference stays literal.
  if (ctx.contextTemplate !== undefined) map['ticket.context'] = fill(ctx.contextTemplate)
  return fill(body)
}
```

`src/main/ipc/resolve-prompt.ts` — `PromptDeps` gains `contextTemplate?: () => string`; the final line becomes:

```ts
  return expandPrompt(body, { ticket: ticketCtx, forge, contextTemplate: deps.contextTemplate?.() })
```

`src/main/config/store.ts` — add to `ConfigSource`:

```ts
  contextTemplate?: () => string
```

and to `ConfigStore` (arrow property, reads fresh each call so in-app edits apply to the next spawn):

```ts
  contextTemplate = (): string => readContextFile(this.promptsDir())
```

(import `readContextFile` from `../prompts/files`).

- [ ] **Step 4: Run tests** — `pnpm test -- files && pnpm test -- expand && pnpm test -- library && pnpm test -- store` → PASS.
- [ ] **Step 5: Gate + commit**

```bash
pnpm typecheck && pnpm test
git add src/main/prompts/files.ts src/main/prompts/files.test.ts src/main/prompts/library.ts src/main/prompts/library.test.ts src/main/prompts/expand.ts src/main/prompts/expand.test.ts src/main/ipc/resolve-prompt.ts src/main/config/store.ts
git commit -m "feat(prompts): file CRUD module + {{ticket.context}} template expansion"
```

---

### Task 6: Prompt-config IPC

**Files:**
- Create: `src/main/ipc/prompt-config-handlers.ts`
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`
- Test: `src/main/ipc/prompt-config-handlers.test.ts`

**Interfaces (produces):**

```ts
// shared/ipc.ts
export type PromptReadResult = { ok: true; text: string } | { ok: false; error: string }
export const PROMPT_FILES = {
  read: 'prompts:read', write: 'prompts:write', create: 'prompts:create', delete: 'prompts:delete',
  readContext: 'prompts:readContext', writeContext: 'prompts:writeContext'
} as const
// prompt-config-handlers.ts
export function registerPromptConfigIpc(store: ConfigStore, getSender: () => Electron.WebContents | undefined): void
// preload api additions
readPrompt(name: string): Promise<PromptReadResult>
writePrompt(name: string, text: string): Promise<SaveResult>
createPrompt(name: string): Promise<PromptReadResult>     // ok → text is the skeleton
deletePrompt(name: string): Promise<SaveResult>
readContext(): Promise<PromptReadResult>
writeContext(text: string): Promise<SaveResult>
```

- [ ] **Step 1: Write failing tests** (`src/main/ipc/prompt-config-handlers.test.ts` — electron mock as before; real `ConfigStore` on a temp dir whose config sets `promptsDir` to a temp path):

```ts
describe('prompt-config handlers', () => {
  it('create → appears in store.prompts (in place) and broadcasts config:changed', async () => {
    // invoke PROMPT_FILES.create('fix-bug') → { ok: true, text: containing 'name: fix-bug' }
    // store.prompts now contains 'fix-bug' AND the array is the same instance as before
    // sender.send called with CONFIG.changed
  })
  it('write updates the file and refreshes prompts; bad frontmatter collision returns ok:false', async () => {
    // create 'one' and 'two'; write 'two' with frontmatter name 'one' → { ok:false, error: /collides/ }
    // store.prompts unchanged; no broadcast for the failed write
  })
  it('delete removes from disk and store.prompts', async () => { /* create then delete → store.prompts empty */ })
  it('readContext falls back to default; writeContext round-trips and broadcasts', async () => {
    // readContext → { ok: true, text: DEFAULT_TICKET_CONTEXT }
    // writeContext('X {{ticket.key}}') → ok; readContext → the new text; broadcast sent
  })
  it('read of a missing prompt returns ok:false', async () => { /* PROMPT_FILES.read('nope') → ok:false */ })
})
```

(Expand comments into real code; expectations are normative.)

- [ ] **Step 2: Run to verify failure** — `pnpm test -- prompt-config` → FAIL.
- [ ] **Step 3: Implement**

`src/shared/ipc.ts` — append the `PromptReadResult` + `PROMPT_FILES` block.

`src/main/ipc/prompt-config-handlers.ts`:

```ts
import { ipcMain } from 'electron'
import { CONFIG, PROMPT_FILES, type PromptReadResult, type SaveResult } from '../../shared/ipc'
import type { ConfigStore } from '../config/store'
import {
  createPromptFile, deletePromptFile, readContextFile, readPromptFile, writeContextFile, writePromptFile
} from '../prompts/files'

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function registerPromptConfigIpc(
  store: ConfigStore,
  getSender: () => Electron.WebContents | undefined
): void {
  // Any successful prompt write refreshes the live array (same instance the
  // terminal/yolo handlers hold) and tells open renderer UI to refetch.
  function changed(): void {
    store.reloadPrompts()
    getSender()?.send(CONFIG.changed)
  }

  ipcMain.handle(PROMPT_FILES.read, (_e, name: string): PromptReadResult => {
    try { return { ok: true, text: readPromptFile(store.promptsDir(), name) } }
    catch (err) { return { ok: false, error: errMsg(err) } }
  })

  ipcMain.handle(PROMPT_FILES.write, (_e, name: string, text: string): SaveResult => {
    try { writePromptFile(store.promptsDir(), name, text); changed(); return { ok: true } }
    catch (err) { return { ok: false, error: errMsg(err) } }
  })

  ipcMain.handle(PROMPT_FILES.create, (_e, name: string): PromptReadResult => {
    try { const text = createPromptFile(store.promptsDir(), name); changed(); return { ok: true, text } }
    catch (err) { return { ok: false, error: errMsg(err) } }
  })

  ipcMain.handle(PROMPT_FILES.delete, (_e, name: string): SaveResult => {
    try { deletePromptFile(store.promptsDir(), name); changed(); return { ok: true } }
    catch (err) { return { ok: false, error: errMsg(err) } }
  })

  ipcMain.handle(PROMPT_FILES.readContext, (): PromptReadResult => {
    try { return { ok: true, text: readContextFile(store.promptsDir()) } }
    catch (err) { return { ok: false, error: errMsg(err) } }
  })

  ipcMain.handle(PROMPT_FILES.writeContext, (_e, text: string): SaveResult => {
    try { writeContextFile(store.promptsDir(), text); changed(); return { ok: true } }
    catch (err) { return { ok: false, error: errMsg(err) } }
  })
}
```

`src/preload/index.ts` — add the six entries per Interfaces. `src/main/index.ts` — `registerPromptConfigIpc(store, getSender)` after `registerConfigIpc`.

- [ ] **Step 4: Run tests** — `pnpm test -- prompt-config` → PASS.
- [ ] **Step 5: Gate + commit**

```bash
pnpm typecheck && pnpm test
git add src/main/ipc/prompt-config-handlers.ts src/main/ipc/prompt-config-handlers.test.ts src/shared/ipc.ts src/preload/index.ts src/main/index.ts
git commit -m "feat(prompts): CRUD + context-template IPC with live store refresh"
```

---

### Task 7: ModalShell, AboutModal, ConfirmDialog

**Files:**
- Create: `src/renderer/src/components/ModalShell.vue`, `AboutModal.vue`, `ConfirmDialog.vue`
- Test: `src/renderer/src/components/AboutModal.test.ts`, `ConfirmDialog.test.ts`

**Interfaces (produces):**
- `ModalShell.vue`: props `{ title: string }`, emits `close`; slots: default body, optional `footer`. Escape and overlay-click emit `close`; the panel itself swallows clicks.
- `AboutModal.vue`: no props; emits `close`; renders `getAppInfo()` name + `v<version>` + the exact line `By Box of Raccoons LLC, 2026`; OK button emits `close`.
- `ConfirmDialog.vue`: props `{ title: string; message: string; confirmLabel?: string }` (default `'Confirm'`); emits `confirm`, `cancel` (ModalShell close → `cancel`).

- [ ] **Step 1: Write failing tests**

```ts
// src/renderer/src/components/AboutModal.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AboutModal from './AboutModal.vue'

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    getAppInfo: vi.fn().mockResolvedValue({ name: 'SeniorDev', version: '1.2.3' })
  }
})

describe('AboutModal', () => {
  it('shows name, version, and the credit line', async () => {
    const w = mount(AboutModal)
    await flushPromises()
    expect(w.text()).toContain('SeniorDev')
    expect(w.text()).toContain('v1.2.3')
    expect(w.text()).toContain('By Box of Raccoons LLC, 2026')
  })
  it('OK and Escape emit close', async () => {
    const w = mount(AboutModal)
    await flushPromises()
    await w.get('button.about-ok').trigger('click')
    expect(w.emitted('close')).toBeTruthy()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('close')!.length).toBeGreaterThanOrEqual(2)
  })
})
```

```ts
// src/renderer/src/components/ConfirmDialog.test.ts
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ConfirmDialog from './ConfirmDialog.vue'

describe('ConfirmDialog', () => {
  it('renders message and emits confirm / cancel', async () => {
    const w = mount(ConfirmDialog, { props: { title: 'Reset?', message: 'Close everything?', confirmLabel: 'Reset' } })
    expect(w.text()).toContain('Close everything?')
    await w.get('button.confirm-yes').trigger('click')
    expect(w.emitted('confirm')).toBeTruthy()
    await w.get('button.confirm-no').trigger('click')
    expect(w.emitted('cancel')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify failure** — `pnpm test -- AboutModal && pnpm test -- ConfirmDialog` → FAIL.
- [ ] **Step 3: Implement**

```vue
<!-- src/renderer/src/components/ModalShell.vue -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
defineProps<{ title: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="modal-overlay" @pointerdown.self="emit('close')">
    <div class="modal" role="dialog" :aria-label="title">
      <header class="modal__head">
        <h2>{{ title }}</h2>
        <button class="modal__x" aria-label="Close" @click="emit('close')">×</button>
      </header>
      <div class="modal__body"><slot /></div>
      <footer v-if="$slots.footer" class="modal__foot"><slot name="footer" /></footer>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0; z-index: 100; display: grid; place-items: center;
  background: oklch(0 0 0 / 0.5);
}
.modal {
  display: flex; flex-direction: column; min-width: 420px; max-width: min(860px, 92vw);
  max-height: 88vh; background: var(--surface-2); color: var(--ink);
  border: 1px solid var(--hairline-strong); border-radius: var(--radius-sm);
  box-shadow: 0 20px 60px oklch(0 0 0 / 0.45);
}
.modal__head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid var(--hairline);
}
.modal__head h2 { margin: 0; font-size: 15px; }
.modal__x { background: transparent; border: 0; color: var(--ink-muted); font-size: 18px; cursor: pointer; }
.modal__x:hover { color: var(--ink); }
.modal__body { padding: 14px 16px; overflow: auto; flex: 1; min-height: 0; }
.modal__foot { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--hairline); }
</style>
```

```vue
<!-- src/renderer/src/components/AboutModal.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import ModalShell from './ModalShell.vue'
import type { AppInfo } from '../../../shared/ipc'
const emit = defineEmits<{ (e: 'close'): void }>()
const info = ref<AppInfo | null>(null)
onMounted(async () => {
  try { info.value = await window.api.getAppInfo() } catch { info.value = { name: 'SeniorDev', version: '?' } }
})
</script>

<template>
  <ModalShell title="About SeniorDev" @close="emit('close')">
    <div class="about">
      <p class="about__name">{{ info?.name ?? '…' }}</p>
      <p class="about__version">v{{ info?.version ?? '…' }}</p>
      <p class="about__credit">By Box of Raccoons LLC, 2026</p>
    </div>
    <template #footer>
      <button class="about-ok" @click="emit('close')">OK</button>
    </template>
  </ModalShell>
</template>

<style scoped>
.about { text-align: center; padding: 8px 24px; }
.about__name { font-size: 18px; font-weight: 700; margin: 0 0 4px; }
.about__version { color: var(--ink-soft); margin: 0 0 12px; }
.about__credit { color: var(--ink-muted); font-size: 12px; margin: 0; }
.about-ok {
  background: var(--teal); color: var(--bg); border: 0;
  border-radius: var(--radius-sm); padding: 6px 18px; cursor: pointer; font-weight: 600;
}
</style>
```

```vue
<!-- src/renderer/src/components/ConfirmDialog.vue -->
<script setup lang="ts">
import ModalShell from './ModalShell.vue'
withDefaults(defineProps<{ title: string; message: string; confirmLabel?: string }>(), { confirmLabel: 'Confirm' })
const emit = defineEmits<{ (e: 'confirm'): void; (e: 'cancel'): void }>()
</script>

<template>
  <ModalShell :title="title" @close="emit('cancel')">
    <p class="confirm__msg">{{ message }}</p>
    <template #footer>
      <button class="confirm-no" @click="emit('cancel')">Cancel</button>
      <button class="confirm-yes" @click="emit('confirm')">{{ confirmLabel }}</button>
    </template>
  </ModalShell>
</template>

<style scoped>
.confirm__msg { margin: 0; }
.confirm-no {
  background: var(--surface); color: var(--ink); border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-sm); padding: 6px 14px; cursor: pointer;
}
.confirm-yes {
  background: var(--rust, #b3552e); color: var(--bg); border: 0;
  border-radius: var(--radius-sm); padding: 6px 14px; cursor: pointer; font-weight: 600;
}
</style>
```

- [ ] **Step 4: Run tests** — `pnpm test -- AboutModal && pnpm test -- ConfirmDialog` → PASS.
- [ ] **Step 5: Gate + commit**

```bash
pnpm typecheck && pnpm test
git add src/renderer/src/components/ModalShell.vue src/renderer/src/components/AboutModal.vue src/renderer/src/components/ConfirmDialog.vue src/renderer/src/components/AboutModal.test.ts src/renderer/src/components/ConfirmDialog.test.ts
git commit -m "feat(renderer): modal shell + About and Confirm dialogs"
```

---

### Task 8: AppConfigModal

**Files:**
- Create: `src/renderer/src/components/AppConfigModal.vue`
- Test: `src/renderer/src/components/AppConfigModal.test.ts`

**Interfaces:**
- Consumes: `ModalShell`, `ConfirmDialog` (Task 7); `window.api.readConfig/saveConfig` (Task 4); `TERM_FONT_FAMILY/TERM_FONT_SIZE` (`../term-style`).
- Produces: `AppConfigModal.vue` — no props; emits `close`.

- [ ] **Step 1: Write failing tests**

```ts
// src/renderer/src/components/AppConfigModal.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AppConfigModal from './AppConfigModal.vue'

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    readConfig: vi.fn().mockResolvedValue({ ok: true, text: 'jira: {}\n', path: 'C:/cfg/config.yaml' }),
    saveConfig: vi.fn().mockResolvedValue({ ok: true })
  }
})

describe('AppConfigModal', () => {
  it('loads the file text and shows the path', async () => {
    const w = mount(AppConfigModal)
    await flushPromises()
    expect((w.get('textarea').element as HTMLTextAreaElement).value).toBe('jira: {}\n')
    expect(w.text()).toContain('C:/cfg/config.yaml')
  })
  it('shows the starter-template notice when isTemplate', async () => {
    ;(window.api.readConfig as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, text: '# starter', path: 'p', isTemplate: true })
    const w = mount(AppConfigModal)
    await flushPromises()
    expect(w.text()).toMatch(/starting template|no config file/i)
  })
  it('save success closes; save failure shows the error and keeps the modal', async () => {
    const w = mount(AppConfigModal)
    await flushPromises()
    await w.get('textarea').setValue('jira: {}\nx: 1\n')
    ;(window.api.saveConfig as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: 'bad yaml at line 2' })
    await w.get('button.cfg-save').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('bad yaml at line 2')
    expect(w.emitted('close')).toBeFalsy()
    ;(window.api.saveConfig as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true })
    await w.get('button.cfg-save').trigger('click')
    await flushPromises()
    expect(window.api.saveConfig).toHaveBeenLastCalledWith('jira: {}\nx: 1\n')
    expect(w.emitted('close')).toBeTruthy()
  })
  it('dirty cancel asks to discard; clean cancel closes immediately', async () => {
    const w = mount(AppConfigModal)
    await flushPromises()
    await w.get('button.cfg-cancel').trigger('click')
    expect(w.emitted('close')).toBeTruthy() // clean → straight out
    const w2 = mount(AppConfigModal)
    await flushPromises()
    await w2.get('textarea').setValue('edited')
    await w2.get('button.cfg-cancel').trigger('click')
    expect(w2.emitted('close')).toBeFalsy() // dirty → confirm first
    expect(w2.text()).toContain('Discard changes?')
    await w2.get('button.confirm-yes').trigger('click')
    expect(w2.emitted('close')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify failure** — `pnpm test -- AppConfigModal` → FAIL.
- [ ] **Step 3: Implement**

```vue
<!-- src/renderer/src/components/AppConfigModal.vue -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import ModalShell from './ModalShell.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { TERM_FONT_FAMILY, TERM_FONT_SIZE } from '../term-style'

const emit = defineEmits<{ (e: 'close'): void }>()
const text = ref('')
const original = ref('')
const path = ref('')
const isTemplate = ref(false)
const error = ref<string | null>(null)
const confirmDiscard = ref(false)
const dirty = computed(() => text.value !== original.value)

onMounted(async () => {
  const res = await window.api.readConfig()
  if (res.ok) {
    text.value = res.text
    original.value = res.text
    path.value = res.path
    isTemplate.value = res.isTemplate === true
  } else {
    error.value = res.error
  }
})

async function save(): Promise<void> {
  error.value = null
  const res = await window.api.saveConfig(text.value)
  if (res.ok) emit('close')
  else error.value = res.error
}

function requestClose(): void {
  if (dirty.value) confirmDiscard.value = true
  else emit('close')
}
</script>

<template>
  <ModalShell title="App Config" @close="requestClose">
    <p class="cfg-path">{{ path }}</p>
    <p v-if="isTemplate" class="cfg-note">No config file exists yet — this is a starting template; Save creates it.</p>
    <textarea
      v-model="text"
      class="cfg-editor"
      spellcheck="false"
      :style="{ fontFamily: TERM_FONT_FAMILY, fontSize: TERM_FONT_SIZE + 'px' }"
    ></textarea>
    <p v-if="error" class="cfg-error">{{ error }}</p>
    <template #footer>
      <button class="cfg-cancel" @click="requestClose">Cancel</button>
      <button class="cfg-save" @click="save">Save</button>
    </template>
  </ModalShell>
  <ConfirmDialog
    v-if="confirmDiscard"
    title="Unsaved changes"
    message="Discard changes?"
    confirm-label="Discard"
    @confirm="emit('close')"
    @cancel="confirmDiscard = false"
  />
</template>

<style scoped>
.cfg-path { margin: 0 0 6px; color: var(--ink-muted); font-size: 12px; }
.cfg-note { margin: 0 0 8px; color: var(--ink-soft); font-size: 12px; }
.cfg-editor {
  width: 64vw; max-width: 100%; height: 52vh; resize: vertical;
  background: var(--surface); color: var(--ink);
  border: 1px solid var(--hairline-strong); border-radius: var(--radius-sm); padding: 10px;
  white-space: pre; overflow: auto;
}
.cfg-editor:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; border-color: transparent; }
.cfg-error {
  margin: 8px 0 0; padding: 8px 10px; font-size: 12px; white-space: pre-wrap;
  color: var(--ink); background: color-mix(in oklch, var(--rust, #b3552e) 18%, var(--surface));
  border: 1px solid color-mix(in oklch, var(--rust, #b3552e) 45%, var(--hairline-strong));
  border-radius: var(--radius-sm);
}
.cfg-cancel {
  background: var(--surface); color: var(--ink); border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-sm); padding: 6px 14px; cursor: pointer;
}
.cfg-save {
  background: var(--teal); color: var(--bg); border: 0;
  border-radius: var(--radius-sm); padding: 6px 18px; cursor: pointer; font-weight: 600;
}
</style>
```

- [ ] **Step 4: Run tests** — `pnpm test -- AppConfigModal` → PASS.
- [ ] **Step 5: Gate + commit**

```bash
pnpm typecheck && pnpm test
git add src/renderer/src/components/AppConfigModal.vue src/renderer/src/components/AppConfigModal.test.ts
git commit -m "feat(renderer): App Config yaml editor modal with validate-first save"
```

---

### Task 9: PromptConfigModal

**Files:**
- Create: `src/renderer/src/components/PromptConfigModal.vue`
- Test: `src/renderer/src/components/PromptConfigModal.test.ts`

**Interfaces:**
- Consumes: `ModalShell`, `ConfirmDialog`; `window.api.listPrompts` (existing), `readPrompt/writePrompt/createPrompt/deletePrompt/readContext/writeContext` (Task 6), `readRecap/saveRecap` (Task 4); term-style.
- Produces: `PromptConfigModal.vue` — no props; emits `close`.

Entry model: `type Entry = { kind: 'context' } | { kind: 'recap' } | { kind: 'prompt'; name: string; description: string }`. List order: Ticket context, YOLO recap, then prompts from `listPrompts()`.

- [ ] **Step 1: Write failing tests**

```ts
// src/renderer/src/components/PromptConfigModal.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PromptConfigModal from './PromptConfigModal.vue'

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    listPrompts: vi.fn().mockResolvedValue([{ name: 'fix-bug', description: 'Fix a bug' }]),
    readPrompt: vi.fn().mockResolvedValue({ ok: true, text: '---\nname: fix-bug\n---\nbody' }),
    writePrompt: vi.fn().mockResolvedValue({ ok: true }),
    createPrompt: vi.fn().mockResolvedValue({ ok: true, text: '---\nname: new-one\n---\n' }),
    deletePrompt: vi.fn().mockResolvedValue({ ok: true }),
    readContext: vi.fn().mockResolvedValue({ ok: true, text: 'CTX {{ticket.key}}' }),
    writeContext: vi.fn().mockResolvedValue({ ok: true }),
    readRecap: vi.fn().mockResolvedValue({ text: 'RECAP', isDefault: true }),
    saveRecap: vi.fn().mockResolvedValue({ ok: true })
  }
})

async function open(): Promise<ReturnType<typeof mount>> {
  const w = mount(PromptConfigModal)
  await flushPromises()
  return w
}

describe('PromptConfigModal', () => {
  it('lists specials pinned first, then prompts', async () => {
    const w = await open()
    const items = w.findAll('.pcfg-item').map((i) => i.text())
    expect(items[0]).toContain('Ticket context')
    expect(items[1]).toContain('YOLO recap')
    expect(items[2]).toContain('fix-bug')
  })
  it('selecting the context loads it; save calls writeContext', async () => {
    const w = await open()
    await w.findAll('.pcfg-item')[0].trigger('click')
    await flushPromises()
    expect((w.get('textarea').element as HTMLTextAreaElement).value).toBe('CTX {{ticket.key}}')
    await w.get('textarea').setValue('NEW CTX')
    await w.get('button.pcfg-save').trigger('click')
    expect(window.api.writeContext).toHaveBeenCalledWith('NEW CTX')
  })
  it('recap shows the default badge and saves via saveRecap', async () => {
    const w = await open()
    await w.findAll('.pcfg-item')[1].trigger('click')
    await flushPromises()
    expect(w.text()).toContain('using built-in default')
    await w.get('textarea').setValue('MY RECAP')
    await w.get('button.pcfg-save').trigger('click')
    expect(window.api.saveRecap).toHaveBeenCalledWith('MY RECAP')
  })
  it('editing a prompt round-trips through readPrompt/writePrompt and surfaces errors', async () => {
    const w = await open()
    await w.findAll('.pcfg-item')[2].trigger('click')
    await flushPromises()
    expect(window.api.readPrompt).toHaveBeenCalledWith('fix-bug')
    ;(window.api.writePrompt as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: 'name collides' })
    await w.get('textarea').setValue('---\nname: one\n---\nx')
    await w.get('button.pcfg-save').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('name collides')
  })
  it('create asks for a name and selects the new prompt', async () => {
    const w = await open()
    await w.get('button.pcfg-new').trigger('click')
    await w.get('input.pcfg-name').setValue('new-one')
    await w.get('button.pcfg-create').trigger('click')
    await flushPromises()
    expect(window.api.createPrompt).toHaveBeenCalledWith('new-one')
    expect(window.api.listPrompts).toHaveBeenCalledTimes(2) // initial + refresh
  })
  it('delete confirms then calls deletePrompt and refreshes', async () => {
    const w = await open()
    await w.findAll('.pcfg-item')[2].trigger('click')
    await flushPromises()
    await w.get('button.pcfg-delete').trigger('click')
    expect(w.text()).toContain('Delete prompt')
    await w.get('button.confirm-yes').trigger('click')
    await flushPromises()
    expect(window.api.deletePrompt).toHaveBeenCalledWith('fix-bug')
  })
})
```

- [ ] **Step 2: Run to verify failure** — `pnpm test -- PromptConfigModal` → FAIL.
- [ ] **Step 3: Implement**

```vue
<!-- src/renderer/src/components/PromptConfigModal.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import ModalShell from './ModalShell.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { TERM_FONT_FAMILY, TERM_FONT_SIZE } from '../term-style'
import type { PromptSummary } from '../../../shared/ipc'

type Entry = { kind: 'context' } | { kind: 'recap' } | { kind: 'prompt'; name: string; description: string }

const emit = defineEmits<{ (e: 'close'): void }>()
const prompts = ref<PromptSummary[]>([])
const selected = ref<Entry | null>(null)
const text = ref('')
const original = ref('')
const error = ref<string | null>(null)
const recapDefault = ref(false)
const creating = ref(false)
const newName = ref('')
const confirmDelete = ref(false)

async function refresh(): Promise<void> {
  try { prompts.value = await window.api.listPrompts() } catch { prompts.value = [] }
}

onMounted(refresh)

async function select(entry: Entry): Promise<void> {
  error.value = null
  if (entry.kind === 'context') {
    const res = await window.api.readContext()
    if (!res.ok) { error.value = res.error; return }
    text.value = res.text
  } else if (entry.kind === 'recap') {
    const res = await window.api.readRecap()
    text.value = res.text
    recapDefault.value = res.isDefault
  } else {
    const res = await window.api.readPrompt(entry.name)
    if (!res.ok) { error.value = res.error; return }
    text.value = res.text
  }
  original.value = text.value
  selected.value = entry
}

async function save(): Promise<void> {
  if (!selected.value) return
  error.value = null
  const s = selected.value
  const res =
    s.kind === 'context' ? await window.api.writeContext(text.value)
    : s.kind === 'recap' ? await window.api.saveRecap(text.value)
    : await window.api.writePrompt(s.name, text.value)
  if (!res.ok) { error.value = res.error; return }
  original.value = text.value
  if (s.kind === 'recap') recapDefault.value = false
  await refresh()
}

async function create(): Promise<void> {
  const name = newName.value.trim()
  if (!name) return
  error.value = null
  const res = await window.api.createPrompt(name)
  if (!res.ok) { error.value = res.error; return }
  creating.value = false
  newName.value = ''
  await refresh()
  text.value = res.text
  original.value = res.text
  selected.value = { kind: 'prompt', name, description: '' }
}

async function doDelete(): Promise<void> {
  if (selected.value?.kind !== 'prompt') return
  const res = await window.api.deletePrompt(selected.value.name)
  confirmDelete.value = false
  if (!res.ok) { error.value = res.error; return }
  selected.value = null
  text.value = ''
  await refresh()
}
</script>

<template>
  <ModalShell title="Prompt Config" @close="emit('close')">
    <div class="pcfg">
      <aside class="pcfg-list">
        <button class="pcfg-item" :class="{ 'pcfg-item--on': selected?.kind === 'context' }" @click="select({ kind: 'context' })">
          <span class="pcfg-item__name">Ticket context</span>
          <span class="pcfg-item__desc">what {{ '\{\{ticket.context\}\}' }} injects</span>
        </button>
        <button class="pcfg-item" :class="{ 'pcfg-item--on': selected?.kind === 'recap' }" @click="select({ kind: 'recap' })">
          <span class="pcfg-item__name">YOLO recap</span>
          <span class="pcfg-item__desc">appended to every YOLO prompt</span>
        </button>
        <hr class="pcfg-sep" />
        <button
          v-for="p in prompts"
          :key="p.name"
          class="pcfg-item"
          :class="{ 'pcfg-item--on': selected?.kind === 'prompt' && selected.name === p.name }"
          @click="select({ kind: 'prompt', name: p.name, description: p.description })"
        >
          <span class="pcfg-item__name">{{ p.name }}</span>
          <span v-if="p.description" class="pcfg-item__desc">{{ p.description }}</span>
        </button>
        <button class="pcfg-new" @click="creating = !creating">+ New prompt</button>
        <form v-if="creating" class="pcfg-create" @submit.prevent="create">
          <input v-model="newName" class="pcfg-name" placeholder="prompt-name" />
          <button class="pcfg-create-go" type="submit" :disabled="!newName.trim()">Create</button>
        </form>
      </aside>
      <section class="pcfg-editor-pane">
        <template v-if="selected">
          <p v-if="selected.kind === 'recap' && recapDefault" class="pcfg-badge">using built-in default</p>
          <textarea
            v-model="text"
            class="pcfg-editor"
            spellcheck="false"
            :style="{ fontFamily: TERM_FONT_FAMILY, fontSize: TERM_FONT_SIZE + 'px' }"
          ></textarea>
          <p v-if="error" class="pcfg-error">{{ error }}</p>
          <div class="pcfg-actions">
            <button v-if="selected.kind === 'prompt'" class="pcfg-delete" @click="confirmDelete = true">Delete</button>
            <span class="pcfg-spacer"></span>
            <button class="pcfg-save" :disabled="text === original" @click="save">Save</button>
          </div>
        </template>
        <p v-else class="pcfg-empty">Select an entry to edit.</p>
        <p v-if="!selected && error" class="pcfg-error">{{ error }}</p>
      </section>
    </div>
  </ModalShell>
  <ConfirmDialog
    v-if="confirmDelete && selected?.kind === 'prompt'"
    title="Delete prompt"
    :message="`Delete prompt '${selected.name}'? The file is removed from disk.`"
    confirm-label="Delete"
    @confirm="doDelete"
    @cancel="confirmDelete = false"
  />
</template>

<style scoped>
.pcfg { display: flex; gap: 12px; min-width: 60vw; min-height: 48vh; }
.pcfg-list { width: 220px; display: flex; flex-direction: column; gap: 2px; overflow: auto; }
.pcfg-item {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  background: transparent; color: var(--ink); border: 0; border-radius: var(--radius-sm);
  padding: 7px 10px; cursor: pointer; text-align: left; width: 100%;
}
.pcfg-item:hover { background: var(--surface); }
.pcfg-item--on { background: var(--surface); outline: 1px solid var(--hairline-strong); }
.pcfg-item__name { font-weight: 600; }
.pcfg-item__desc { color: var(--ink-muted); font-size: 12px; }
.pcfg-sep { width: 100%; border: 0; border-top: 1px solid var(--hairline); margin: 6px 0; }
.pcfg-new {
  margin-top: 6px; background: var(--surface); color: var(--ink);
  border: 1px dashed var(--hairline-strong); border-radius: var(--radius-sm); padding: 6px; cursor: pointer;
}
.pcfg-create { display: flex; gap: 6px; margin-top: 6px; }
.pcfg-name {
  flex: 1; min-width: 0; background: var(--surface); color: var(--ink);
  border: 1px solid var(--hairline-strong); border-radius: var(--radius-sm); padding: 5px 8px;
}
.pcfg-create-go {
  background: var(--teal); color: var(--bg); border: 0; border-radius: var(--radius-sm);
  padding: 5px 10px; cursor: pointer; font-weight: 600;
}
.pcfg-create-go:disabled { opacity: 0.5; cursor: default; }
.pcfg-editor-pane { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.pcfg-badge { margin: 0 0 6px; color: var(--ink-muted); font-size: 12px; font-style: italic; }
.pcfg-editor {
  flex: 1; min-height: 34vh; resize: vertical; background: var(--surface); color: var(--ink);
  border: 1px solid var(--hairline-strong); border-radius: var(--radius-sm); padding: 10px;
  white-space: pre-wrap;
}
.pcfg-editor:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; border-color: transparent; }
.pcfg-error {
  margin: 8px 0 0; padding: 8px 10px; font-size: 12px; white-space: pre-wrap;
  color: var(--ink); background: color-mix(in oklch, var(--rust, #b3552e) 18%, var(--surface));
  border: 1px solid color-mix(in oklch, var(--rust, #b3552e) 45%, var(--hairline-strong));
  border-radius: var(--radius-sm);
}
.pcfg-actions { display: flex; align-items: center; margin-top: 8px; }
.pcfg-spacer { flex: 1; }
.pcfg-delete {
  background: transparent; color: var(--ink-soft); border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-sm); padding: 6px 12px; cursor: pointer;
}
.pcfg-save {
  background: var(--teal); color: var(--bg); border: 0; border-radius: var(--radius-sm);
  padding: 6px 18px; cursor: pointer; font-weight: 600;
}
.pcfg-save:disabled { opacity: 0.5; cursor: default; }
.pcfg-empty { color: var(--ink-muted); }
</style>
```

- [ ] **Step 4: Run tests** — `pnpm test -- PromptConfigModal` → PASS.
- [ ] **Step 5: Gate + commit**

```bash
pnpm typecheck && pnpm test
git add src/renderer/src/components/PromptConfigModal.vue src/renderer/src/components/PromptConfigModal.test.ts
git commit -m "feat(renderer): Prompt Config modal - context/recap editing + prompt CRUD"
```

---

### Task 10: App wiring — menu dispatch, New Session reset, config-changed refresh

**Files:**
- Modify: `src/renderer/src/App.vue`
- Modify: `src/renderer/src/components/LeftPanel.vue` (expose `closeAll`)
- Modify: `src/renderer/src/components/RightPanel.vue` (expose `closeAll`, `hasSessions`)
- Modify: `src/renderer/src/components/NewSessionMenu.vue` (refetch on config:changed)
- Test: `src/renderer/src/App.test.ts` (create)

**Interfaces:**
- Consumes: all four modals; `window.api.onMenuAction`, `onConfigChanged` (Tasks 3/4).
- Produces: `LeftPanel` exposes `closeAll(): void`; `RightPanel` exposes `closeAll(): void` and `hasSessions(): boolean` (alongside the existing `startStartupSession`/`openTickets`).

Rules: only ONE modal at a time — a menu action while any modal is open is ignored (the open modal keeps focus, never stacks); `new-session` with zero sessions resets silently, with sessions shows ConfirmDialog first.

- [ ] **Step 1: Write failing tests** (`src/renderer/src/App.test.ts` — stub LeftPanel/RightPanel/modals the way `RightPanel.test.ts` stubs children; capture the `onMenuAction` callback from the api mock):

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import App from './App.vue'
import type { MenuAction } from '../../shared/ipc'

let menuCb: (a: MenuAction) => void

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    getStartup: vi.fn().mockResolvedValue({ tickets: [] }),
    onMenuAction: vi.fn((cb) => { menuCb = cb; return () => {} }),
    getAppInfo: vi.fn().mockResolvedValue({ name: 'SeniorDev', version: '1.0.0' })
  }
})

// Stubs: LeftPanel/RightPanel with exposed spies; AppConfigModal/PromptConfigModal/AboutModal as named stubs.
// (Follow RightPanel.test.ts's global-stubs pattern; the stub components must define the exposed
// methods via defineExpose in a real SFC-less stub or use `template` + `methods` stubs.)

describe('App menu wiring', () => {
  it('about opens AboutModal; a second action while open is ignored (no stacking)', async () => {
    const w = mount(App /* with stubs */)
    await flushPromises()
    menuCb('about')
    await flushPromises()
    expect(w.findComponent({ name: 'AboutModal' }).exists()).toBe(true)
    menuCb('app-config') // ignored — About still open, AppConfig NOT mounted
    await flushPromises()
    expect(w.findComponent({ name: 'AppConfigModal' }).exists()).toBe(false)
  })
  it('app-config and prompt-config open their modals', async () => { /* menuCb each → modal exists */ })
  it('new-session with no sessions resets immediately', async () => {
    // RightPanel stub hasSessions → false; menuCb('new-session')
    // expect leftPanel.closeAll and rightPanel.closeAll called, no ConfirmDialog shown
  })
  it('new-session with sessions confirms first, then resets', async () => {
    // hasSessions → true; menuCb('new-session') → ConfirmDialog visible, closeAll NOT yet called
    // click confirm-yes → both closeAll called
  })
})
```

(Expand skeleton comments into real assertions; the behavior statements are normative.)

- [ ] **Step 2: Run to verify failure** — `pnpm test -- App.test` → FAIL.
- [ ] **Step 3: Implement**

`LeftPanel.vue` — add and expose:

```ts
function closeAll(): void {
  tabs.value = []
  activeKey.value = null
  keyInput.value = ''
  error.value = null
}

defineExpose({ openTickets, closeAll })
```

`RightPanel.vue` — add and expose (closing through `closeTerm` so unmount hooks kill PTYs/YOLO runs):

```ts
function closeAll(): void {
  for (const t of [...terms.value]) closeTerm(t.id)
}

function hasSessions(): boolean {
  return terms.value.length > 0
}

defineExpose({ startStartupSession, closeAll, hasSessions })
```

`NewSessionMenu.vue` — refetch on config changes; add to the refs/lifecycle:

```ts
let offConfig: (() => void) | null = null

async function refetch(): Promise<void> {
  try { prompts.value = await window.api.listPrompts() } catch { prompts.value = [] }
  try { yoloAvailable.value = (await window.api.yoloCaps()).available } catch { yoloAvailable.value = false }
}

// in onMounted, replace the two existing fetch lines with:
  offConfig = window.api.onConfigChanged(() => void refetch())
  await refetch()

// in onBeforeUnmount, add:
  offConfig?.()
```

`App.vue` — full new script/template:

```vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import LeftPanel from './components/LeftPanel.vue'
import RightPanel from './components/RightPanel.vue'
import AboutModal from './components/AboutModal.vue'
import AppConfigModal from './components/AppConfigModal.vue'
import PromptConfigModal from './components/PromptConfigModal.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import type { MenuAction } from '../../shared/ipc'

const activeTicketKey = ref<string | null>(null)
const leftPanel = ref<InstanceType<typeof LeftPanel> | null>(null)
const rightPanel = ref<InstanceType<typeof RightPanel> | null>(null)
const modal = ref<'about' | 'app-config' | 'prompt-config' | null>(null)
const confirmReset = ref(false)
let offMenu: (() => void) | null = null

function onMenu(action: MenuAction): void {
  if (action === 'new-session') {
    requestNewSession()
    return
  }
  // One modal at a time: an action while any modal is open keeps the open one.
  if (modal.value === null && !confirmReset.value) modal.value = action
}

function requestNewSession(): void {
  if (modal.value !== null) return
  if (rightPanel.value?.hasSessions()) confirmReset.value = true
  else doReset()
}

function doReset(): void {
  rightPanel.value?.closeAll()
  leftPanel.value?.closeAll()
  activeTicketKey.value = null
  confirmReset.value = false
}

onMounted(async () => {
  offMenu = window.api.onMenuAction(onMenu)
  try {
    const startup = await window.api.getStartup()
    if (startup.tickets.length) {
      await leftPanel.value?.openTickets(startup.tickets)
      activeTicketKey.value = startup.tickets[0]
    }
    if (startup.session) rightPanel.value?.startStartupSession(startup.session)
  } catch (err) {
    // Startup is best-effort: fall back to an empty workbench the user drives manually.
    console.error('Startup load failed:', err)
  }
})

onBeforeUnmount(() => {
  offMenu?.()
})
</script>

<template>
  <div class="shell">
    <LeftPanel ref="leftPanel" @active-ticket="activeTicketKey = $event" />
    <RightPanel ref="rightPanel" :active-ticket-key="activeTicketKey" />
  </div>
  <AboutModal v-if="modal === 'about'" @close="modal = null" />
  <AppConfigModal v-if="modal === 'app-config'" @close="modal = null" />
  <PromptConfigModal v-if="modal === 'prompt-config'" @close="modal = null" />
  <ConfirmDialog
    v-if="confirmReset"
    title="New Session"
    message="Close all tickets and sessions? Running sessions will be killed."
    confirm-label="Close all"
    @confirm="doReset"
    @cancel="confirmReset = false"
  />
</template>
```

- [ ] **Step 4: Run tests** — `pnpm test -- App.test` → PASS; also `pnpm test -- NewSessionMenu` if a test file exists for it (update its api mock with `onConfigChanged`), and `pnpm test -- RightPanel` (stub api may need `onConfigChanged`).
- [ ] **Step 5: Gate + commit**

```bash
pnpm typecheck && pnpm test
git add src/renderer/src/App.vue src/renderer/src/App.test.ts src/renderer/src/components/LeftPanel.vue src/renderer/src/components/RightPanel.vue src/renderer/src/components/RightPanel.test.ts src/renderer/src/components/NewSessionMenu.vue
git commit -m "feat(renderer): menu-driven modals, New Session reset, live config refresh"
```

---

### Task 11: README + full gates + manual checklist

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README** — add a short "In-app configuration" section: the File/Edit/Config/About menu; Config → App Config (edit `config.yaml` in-app, validated save, live reload for new sessions) and Prompt Config (ticket-context template `_ticket-context.md`, `{{ticket.context}}` placeholder, YOLO recap, prompt CRUD); File → New Session (`Ctrl+N`) resets the workbench. Mention `{{ticket.context}}` in the existing prompts paragraph.
- [ ] **Step 2: Full gate vs baseline** — `pnpm typecheck && pnpm test && pnpm build`; account for every count delta vs Task 0.
- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: in-app configuration README"
```

- [ ] **Step 4: Manual verification (USER):**
  1. `pnpm dev` → the menu shows File / Edit / Config / About only.
  2. Config → App Config: edit a value (e.g. `defaultTool`), Save → open a NEW session and confirm it uses the new value while a previously running session is untouched. Try saving broken yaml → precise error, file unchanged.
  3. Config → Prompt Config: edit the ticket-context template, create a prompt using `{{ticket.context}}`, confirm it appears in the YOLO/New-session menu without restart, run it, delete it.
  4. File → New Session with sessions running → confirm dialog → everything closes; `Ctrl+N` works.
  5. About → name/version/credit render (if the name shows `seniordev-app`, set `productName: SeniorDev` in electron-builder config/package.json — cosmetic follow-up).
  6. Boot with a deliberately broken config.yaml → app opens, App Config shows the file, sessions error cleanly until fixed in-app.

Merge to `develop` only after the user's manual pass, with `git merge --no-ff feature/in-app-config`.
