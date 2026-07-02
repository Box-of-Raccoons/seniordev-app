# SeniorDev Phase 2 — Interactive Terminals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. Workers make file edits only; the orchestrator runs all tests/typecheck/build/git.

**Goal:** A tabbed terminal multiplexer in the right panel. Each tab is a real interactive PTY (node-pty) running the configured CLI tool in a resolved working directory, with live I/O and resize via xterm.js.

**Architecture:** Main process owns PTY lifecycle via a `TerminalManager` (injected spawner for testability; real `node-pty` only wired in `main/index.ts`). Renderer hosts xterm.js terminal tabs and talks to main over new IPC channels (`pty:spawn/write/resize/kill` + `pty:data/exit` events). The active ticket key is lifted to `App.vue` so a new terminal's cwd can be resolved from `config.repos`.

**Tech Stack:** node-pty 1.1.0, @xterm/xterm 6.0.0, @xterm/addon-fit 0.11.0 (already installed), Electron, Vue 3, Vitest.

## Global Constraints

- **pnpm**; `pnpm test` (`vitest run`), `pnpm typecheck`, `pnpm build`. Branch: `feat/phase2-terminals` off `develop`.
- No AI-attribution in commit messages.
- **Native module isolation:** `node-pty` must be imported ONLY in `src/main/terminal/node-pty-spawner.ts` and wired in `src/main/index.ts`. No test-imported module may import it (tests inject a fake `PtySpawner`). This keeps `pnpm test` runnable regardless of the native ABI.
- **Token/security posture unchanged:** renderer still gets no secrets; terminal I/O is opaque bytes over IPC.
- **Palette:** raccourier tokens from Phase 1 (`tokens.css`); reuse existing CSS custom properties. No side-stripe callouts.
- **One PTY per tab.** A tab close kills its PTY; app quit kills all.
- **Interfaces from Phase 1 (do not change):** `Config` (`src/main/config/schema.ts`) with `repos: {key,path,branchPrefix,forge?}[]`, `cliTools: Record<string,{command,interactiveArgs,yoloArgs,promptDelivery,promptArg?}>`, `defaultTool`. `window.api` currently `{ getTicket }`.

## File Structure (Phase 2)

```
src/shared/ipc.ts                 (MODIFY: add TERM channels + terminal types)
src/main/terminal/
  resolve.ts                      (resolveCwd)
  session.ts                      (buildInteractiveLaunch)
  manager.ts                      (TerminalManager + PtySpawner/PtyProcess interfaces)
  node-pty-spawner.ts             (real node-pty adapter — ONLY native import)
src/main/ipc/terminal-handlers.ts (registerTerminalIpc)
src/preload/index.ts              (MODIFY: add terminal api)
src/main/index.ts                 (MODIFY: wire terminal ipc + killAll on quit)
src/renderer/src/env.d.ts         (MODIFY: extend Api typing — auto via preload type)
src/renderer/src/App.vue          (MODIFY: hold activeTicketKey, pass to RightPanel)
src/renderer/src/components/
  LeftPanel.vue                   (MODIFY: emit active-ticket key changes)
  RightPanel.vue                  (NEW: terminal tabs + New session)
  TerminalView.vue                (NEW: xterm.js instance per tab)
```

---

### Task 1: Terminal IPC types, cwd resolver, launch builder

**Files:**
- Modify: `src/shared/ipc.ts`
- Create: `src/main/terminal/resolve.ts`, `src/main/terminal/session.ts`
- Test: `src/main/terminal/resolve.test.ts`, `src/main/terminal/session.test.ts`

**Interfaces:**
- Produces:
  - In `shared/ipc.ts`: `TERM = { spawn:'pty:spawn', write:'pty:write', resize:'pty:resize', kill:'pty:kill', data:'pty:data', exit:'pty:exit' }`; `interface SpawnTerminalRequest { id:string; tool?:string; ticketKey?:string; cwdOverride?:string; cols:number; rows:number }`; `interface TerminalDataEvent { id:string; data:string }`; `interface TerminalExitEvent { id:string; exitCode:number }`; `type SpawnResult = {ok:true}|{ok:false;error:string}`.
  - `resolveCwd(config: Config, ticketKey?: string, cwdOverride?: string): string`
  - `interface Launch { file:string; args:string[]; cwd:string }`; `buildInteractiveLaunch(config: Config, opts:{tool?:string;ticketKey?:string;cwdOverride?:string}): Launch`

- [ ] **Step 1: Extend `src/shared/ipc.ts`** — append after the existing exports:

```ts
export interface SpawnTerminalRequest {
  id: string
  tool?: string
  ticketKey?: string
  cwdOverride?: string
  cols: number
  rows: number
}
export interface TerminalDataEvent { id: string; data: string }
export interface TerminalExitEvent { id: string; exitCode: number }
export type SpawnResult = { ok: true } | { ok: false; error: string }

export const TERM = {
  spawn: 'pty:spawn',
  write: 'pty:write',
  resize: 'pty:resize',
  kill: 'pty:kill',
  data: 'pty:data',
  exit: 'pty:exit'
} as const
```

- [ ] **Step 2: Write the failing resolver test** — `src/main/terminal/resolve.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { homedir } from 'node:os'
import { resolveCwd } from './resolve'
import type { Config } from '../config/schema'

const cfg = {
  repos: [{ key: 'PROJ', path: 'C:/code/backend', branchPrefix: 'feature/' }]
} as unknown as Config

describe('resolveCwd', () => {
  it('maps a ticket key prefix to the repo path', () => {
    expect(resolveCwd(cfg, 'PROJ-123')).toBe('C:/code/backend')
  })
  it('is case-insensitive on the key', () => {
    expect(resolveCwd(cfg, 'proj-9')).toBe('C:/code/backend')
  })
  it('prefers an explicit cwdOverride', () => {
    expect(resolveCwd(cfg, 'PROJ-1', 'D:/elsewhere')).toBe('D:/elsewhere')
  })
  it('falls back to homedir for an unmapped ticket', () => {
    expect(resolveCwd(cfg, 'NOPE-1')).toBe(homedir())
  })
  it('falls back to homedir when no ticket is given', () => {
    expect(resolveCwd(cfg)).toBe(homedir())
  })
})
```

- [ ] **Step 3: Run to verify it fails** — `pnpm test src/main/terminal/resolve.test.ts` → FAIL (module missing).

- [ ] **Step 4: Write `src/main/terminal/resolve.ts`**

```ts
import { homedir } from 'node:os'
import type { Config } from '../config/schema'

export function resolveCwd(config: Config, ticketKey?: string, cwdOverride?: string): string {
  if (cwdOverride && cwdOverride.trim()) return cwdOverride
  if (ticketKey) {
    const key = ticketKey.toUpperCase()
    const repo = config.repos.find((r) => key.startsWith(r.key.toUpperCase()))
    if (repo) return repo.path
  }
  return homedir()
}
```

- [ ] **Step 5: Run to verify it passes** — `pnpm test src/main/terminal/resolve.test.ts` → PASS (5).

- [ ] **Step 6: Write the failing launch test** — `src/main/terminal/session.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { buildInteractiveLaunch } from './session'
import type { Config } from '../config/schema'

const cfg = {
  defaultTool: 'claude',
  cliTools: {
    claude: { command: 'claude', interactiveArgs: [], yoloArgs: ['--permission-mode', 'bypassPermissions'], promptDelivery: 'stdin' },
    codex: { command: 'codex', interactiveArgs: ['--foo'], yoloArgs: ['--yolo'], promptDelivery: 'arg', promptArg: '{{prompt}}' }
  },
  repos: [{ key: 'PROJ', path: 'C:/code/backend', branchPrefix: '' }]
} as unknown as Config

describe('buildInteractiveLaunch', () => {
  it('uses the default tool and interactiveArgs (not yoloArgs)', () => {
    const l = buildInteractiveLaunch(cfg, {})
    expect(l.file).toBe('claude')
    expect(l.args).toEqual([])
  })
  it('uses an explicit tool and resolves cwd from the ticket', () => {
    const l = buildInteractiveLaunch(cfg, { tool: 'codex', ticketKey: 'PROJ-7' })
    expect(l.file).toBe('codex')
    expect(l.args).toEqual(['--foo'])
    expect(l.cwd).toBe('C:/code/backend')
  })
  it('throws on an unknown tool', () => {
    expect(() => buildInteractiveLaunch(cfg, { tool: 'nope' })).toThrow(/unknown cli tool/i)
  })
})
```

- [ ] **Step 7: Run to verify it fails** — `pnpm test src/main/terminal/session.test.ts` → FAIL.

- [ ] **Step 8: Write `src/main/terminal/session.ts`**

```ts
import type { Config } from '../config/schema'
import { resolveCwd } from './resolve'

export interface Launch {
  file: string
  args: string[]
  cwd: string
}

export function buildInteractiveLaunch(
  config: Config,
  opts: { tool?: string; ticketKey?: string; cwdOverride?: string }
): Launch {
  const toolName = opts.tool ?? config.defaultTool
  const tool = config.cliTools[toolName]
  if (!tool) throw new Error(`Unknown CLI tool: ${toolName}`)
  return {
    file: tool.command,
    args: [...tool.interactiveArgs],
    cwd: resolveCwd(config, opts.ticketKey, opts.cwdOverride)
  }
}
```

- [ ] **Step 9: Run to verify it passes** — `pnpm test src/main/terminal/session.test.ts` → PASS (3).

- [ ] **Step 10: Commit**

```bash
git add src/shared/ipc.ts src/main/terminal/resolve.ts src/main/terminal/resolve.test.ts src/main/terminal/session.ts src/main/terminal/session.test.ts
git commit -m "feat(terminal): cwd resolver, interactive launch builder, ipc types"
```

---

### Task 2: TerminalManager (PTY lifecycle)

**Files:**
- Create: `src/main/terminal/manager.ts`
- Test: `src/main/terminal/manager.test.ts`

**Interfaces:**
- Produces:
  - `interface PtyProcess { onData(cb:(d:string)=>void):void; onExit(cb:(e:{exitCode:number})=>void):void; write(d:string):void; resize(c:number,r:number):void; kill():void }`
  - `interface SpawnOptions { file:string; args:string[]; cwd:string; cols:number; rows:number }`
  - `type PtySpawner = (opts: SpawnOptions) => PtyProcess`
  - `interface TerminalManagerCallbacks { onData:(id:string,data:string)=>void; onExit:(id:string,exitCode:number)=>void }`
  - `class TerminalManager { constructor(spawnPty: PtySpawner, cb: TerminalManagerCallbacks); spawn(id,opts):void; write(id,data):void; resize(id,cols,rows):void; kill(id):void; killAll():void; has(id):boolean; get size():number }`

- [ ] **Step 1: Write the failing test** — `src/main/terminal/manager.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest'
import { TerminalManager, type PtyProcess, type PtySpawner } from './manager'

function fakePty() {
  let dataCb: (d: string) => void = () => {}
  let exitCb: (e: { exitCode: number }) => void = () => {}
  const pty: PtyProcess & { emitData: (d: string) => void; emitExit: (c: number) => void } = {
    onData: (cb) => { dataCb = cb },
    onExit: (cb) => { exitCb = cb },
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    emitData: (d) => dataCb(d),
    emitExit: (c) => exitCb({ exitCode: c })
  }
  return pty
}

const opts = { file: 'claude', args: [], cwd: '/tmp', cols: 80, rows: 24 }

describe('TerminalManager', () => {
  it('spawns and forwards data with the session id', () => {
    const pty = fakePty()
    const spawner: PtySpawner = () => pty
    const onData = vi.fn()
    const m = new TerminalManager(spawner, { onData, onExit: vi.fn() })
    m.spawn('a', opts)
    pty.emitData('hello')
    expect(onData).toHaveBeenCalledWith('a', 'hello')
    expect(m.has('a')).toBe(true)
  })

  it('removes the session on exit and forwards exit code', () => {
    const pty = fakePty()
    const onExit = vi.fn()
    const m = new TerminalManager(() => pty, { onData: vi.fn(), onExit })
    m.spawn('a', opts)
    pty.emitExit(0)
    expect(onExit).toHaveBeenCalledWith('a', 0)
    expect(m.has('a')).toBe(false)
  })

  it('delegates write/resize/kill to the right session', () => {
    const pty = fakePty()
    const m = new TerminalManager(() => pty, { onData: vi.fn(), onExit: vi.fn() })
    m.spawn('a', opts)
    m.write('a', 'x'); m.resize('a', 100, 40); m.kill('a')
    expect(pty.write).toHaveBeenCalledWith('x')
    expect(pty.resize).toHaveBeenCalledWith(100, 40)
    expect(pty.kill).toHaveBeenCalled()
    expect(m.has('a')).toBe(false)
  })

  it('throws on duplicate id and no-ops write to unknown id', () => {
    const m = new TerminalManager(() => fakePty(), { onData: vi.fn(), onExit: vi.fn() })
    m.spawn('a', opts)
    expect(() => m.spawn('a', opts)).toThrow(/already exists/i)
    expect(() => m.write('ghost', 'x')).not.toThrow()
  })

  it('killAll kills every session', () => {
    const p1 = fakePty(), p2 = fakePty()
    const spawner = vi.fn().mockReturnValueOnce(p1).mockReturnValueOnce(p2)
    const m = new TerminalManager(spawner as unknown as PtySpawner, { onData: vi.fn(), onExit: vi.fn() })
    m.spawn('a', opts); m.spawn('b', opts)
    m.killAll()
    expect(p1.kill).toHaveBeenCalled()
    expect(p2.kill).toHaveBeenCalled()
    expect(m.size).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `pnpm test src/main/terminal/manager.test.ts` → FAIL.

- [ ] **Step 3: Write `src/main/terminal/manager.ts`**

```ts
export interface PtyProcess {
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number }) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

export interface SpawnOptions {
  file: string
  args: string[]
  cwd: string
  cols: number
  rows: number
}

export type PtySpawner = (opts: SpawnOptions) => PtyProcess

export interface TerminalManagerCallbacks {
  onData: (id: string, data: string) => void
  onExit: (id: string, exitCode: number) => void
}

export class TerminalManager {
  private readonly sessions = new Map<string, PtyProcess>()

  constructor(
    private readonly spawnPty: PtySpawner,
    private readonly cb: TerminalManagerCallbacks
  ) {}

  spawn(id: string, opts: SpawnOptions): void {
    if (this.sessions.has(id)) throw new Error(`Terminal ${id} already exists`)
    const pty = this.spawnPty(opts)
    pty.onData((data) => this.cb.onData(id, data))
    pty.onExit(({ exitCode }) => {
      this.cb.onExit(id, exitCode)
      this.sessions.delete(id)
    })
    this.sessions.set(id, pty)
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.resize(cols, rows)
  }

  kill(id: string): void {
    const pty = this.sessions.get(id)
    if (pty) {
      pty.kill()
      this.sessions.delete(id)
    }
  }

  killAll(): void {
    for (const pty of this.sessions.values()) pty.kill()
    this.sessions.clear()
  }

  has(id: string): boolean {
    return this.sessions.has(id)
  }

  get size(): number {
    return this.sessions.size
  }
}
```

- [ ] **Step 4: Run to verify it passes** — `pnpm test src/main/terminal/manager.test.ts` → PASS (5).

- [ ] **Step 5: Commit**

```bash
git add src/main/terminal/manager.ts src/main/terminal/manager.test.ts
git commit -m "feat(terminal): TerminalManager PTY lifecycle with injected spawner"
```

---

### Task 3: Terminal IPC handlers + real node-pty adapter + preload

**Files:**
- Create: `src/main/terminal/node-pty-spawner.ts`, `src/main/ipc/terminal-handlers.ts`
- Modify: `src/preload/index.ts`
- Test: `src/main/ipc/terminal-handlers.test.ts`

**Interfaces:**
- Consumes: `TerminalManager`, `buildInteractiveLaunch`, `TERM`, `SpawnTerminalRequest`, `SpawnResult`, `Config`, `PtySpawner`.
- Produces:
  - `nodePtySpawner: PtySpawner` (the only file importing `node-pty`).
  - `registerTerminalIpc(config: Config, getSender: () => Electron.WebContents | undefined, spawner: PtySpawner): TerminalManager` — registers `pty:spawn` (handle) and `pty:write/resize/kill` (on), forwards manager `onData`/`onExit` to `getSender().send(TERM.data|exit, …)`. **Does NOT import node-pty** (spawner is injected).
  - `window.api` gains: `spawnTerminal(req): Promise<SpawnResult>`, `writeTerminal(id,data)`, `resizeTerminal(id,cols,rows)`, `killTerminal(id)`, `onTerminalData(cb): ()=>void`, `onTerminalExit(cb): ()=>void`.

- [ ] **Step 1: Write the real adapter** — `src/main/terminal/node-pty-spawner.ts`

```ts
import { spawn as ptySpawn } from 'node-pty'
import type { PtySpawner, PtyProcess } from './manager'

// The ONLY module that imports the native node-pty. Never import this from a test.
export const nodePtySpawner: PtySpawner = ({ file, args, cwd, cols, rows }) => {
  const proc = ptySpawn(file, args, {
    name: 'xterm-color',
    cwd,
    cols,
    rows,
    env: process.env as Record<string, string>
  })
  const wrapper: PtyProcess = {
    onData: (cb) => { proc.onData(cb) },
    onExit: (cb) => { proc.onExit(({ exitCode }) => cb({ exitCode })) },
    write: (data) => proc.write(data),
    resize: (c, r) => proc.resize(c, r),
    kill: () => proc.kill()
  }
  return wrapper
}
```

- [ ] **Step 2: Write the failing handler test** — `src/main/ipc/terminal-handlers.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const handleMap = new Map<string, (...a: unknown[]) => unknown>()
const onMap = new Map<string, (...a: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (...a: unknown[]) => unknown) => handleMap.set(ch, fn),
    on: (ch: string, fn: (...a: unknown[]) => unknown) => onMap.set(ch, fn)
  }
}))

import { registerTerminalIpc } from './terminal-handlers'
import type { PtyProcess, PtySpawner } from '../terminal/manager'
import type { Config } from '../config/schema'

const cfg = {
  defaultTool: 'claude',
  cliTools: { claude: { command: 'claude', interactiveArgs: [], yoloArgs: [], promptDelivery: 'stdin' } },
  repos: []
} as unknown as Config

function fakePty() {
  let dataCb: (d: string) => void = () => {}
  let exitCb: (e: { exitCode: number }) => void = () => {}
  return {
    onData: (cb: (d: string) => void) => { dataCb = cb },
    onExit: (cb: (e: { exitCode: number }) => void) => { exitCb = cb },
    write: vi.fn(), resize: vi.fn(), kill: vi.fn(),
    emitData: (d: string) => dataCb(d),
    emitExit: (c: number) => exitCb({ exitCode: c })
  }
}

beforeEach(() => { handleMap.clear(); onMap.clear() })

describe('registerTerminalIpc', () => {
  it('spawns on pty:spawn and forwards data to the sender with the id', async () => {
    const pty = fakePty()
    const spawner: PtySpawner = () => pty as unknown as PtyProcess
    const send = vi.fn()
    registerTerminalIpc(cfg, () => ({ send } as unknown as Electron.WebContents), spawner)

    const res = await handleMap.get('pty:spawn')!({}, { id: 'a', cols: 80, rows: 24 })
    expect(res).toEqual({ ok: true })
    pty.emitData('out')
    expect(send).toHaveBeenCalledWith('pty:data', { id: 'a', data: 'out' })
  })

  it('returns {ok:false} when the launch cannot be built', async () => {
    registerTerminalIpc(cfg, () => undefined, (() => fakePty() as unknown as PtyProcess))
    const res = await handleMap.get('pty:spawn')!({}, { id: 'b', tool: 'ghost', cols: 80, rows: 24 })
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/unknown cli tool/i) })
  })

  it('routes pty:write to the manager', async () => {
    const pty = fakePty()
    registerTerminalIpc(cfg, () => undefined, () => pty as unknown as PtyProcess)
    await handleMap.get('pty:spawn')!({}, { id: 'a', cols: 80, rows: 24 })
    onMap.get('pty:write')!({}, 'a', 'typed')
    expect(pty.write).toHaveBeenCalledWith('typed')
  })
})
```

- [ ] **Step 3: Run to verify it fails** — `pnpm test src/main/ipc/terminal-handlers.test.ts` → FAIL.

- [ ] **Step 4: Write `src/main/ipc/terminal-handlers.ts`**

```ts
import { ipcMain } from 'electron'
import type { Config } from '../config/schema'
import { TerminalManager, type PtySpawner } from '../terminal/manager'
import { buildInteractiveLaunch } from '../terminal/session'
import { TERM, type SpawnTerminalRequest, type SpawnResult } from '../../shared/ipc'

export function registerTerminalIpc(
  config: Config,
  getSender: () => Electron.WebContents | undefined,
  spawner: PtySpawner
): TerminalManager {
  const manager = new TerminalManager(spawner, {
    onData: (id, data) => getSender()?.send(TERM.data, { id, data }),
    onExit: (id, exitCode) => getSender()?.send(TERM.exit, { id, exitCode })
  })

  ipcMain.handle(TERM.spawn, (_e, req: SpawnTerminalRequest): SpawnResult => {
    try {
      const launch = buildInteractiveLaunch(config, req)
      manager.spawn(req.id, { ...launch, cols: req.cols, rows: req.rows })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.on(TERM.write, (_e, id: string, data: string) => manager.write(id, data))
  ipcMain.on(TERM.resize, (_e, id: string, cols: number, rows: number) => manager.resize(id, cols, rows))
  ipcMain.on(TERM.kill, (_e, id: string) => manager.kill(id))

  return manager
}
```

- [ ] **Step 5: Run to verify it passes** — `pnpm test src/main/ipc/terminal-handlers.test.ts` → PASS (3).

- [ ] **Step 6: Extend the preload bridge** — replace `src/preload/index.ts`

```ts
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, TERM, type GetTicketResult } from '../shared/ipc'
import type { SpawnTerminalRequest, SpawnResult, TerminalDataEvent, TerminalExitEvent } from '../shared/ipc'

const api = {
  getTicket: (key: string): Promise<GetTicketResult> => ipcRenderer.invoke(IPC.getTicket, key),

  spawnTerminal: (req: SpawnTerminalRequest): Promise<SpawnResult> => ipcRenderer.invoke(TERM.spawn, req),
  writeTerminal: (id: string, data: string): void => ipcRenderer.send(TERM.write, id, data),
  resizeTerminal: (id: string, cols: number, rows: number): void => ipcRenderer.send(TERM.resize, id, cols, rows),
  killTerminal: (id: string): void => ipcRenderer.send(TERM.kill, id),
  onTerminalData: (cb: (e: TerminalDataEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: TerminalDataEvent): void => cb(payload)
    ipcRenderer.on(TERM.data, listener)
    return () => ipcRenderer.off(TERM.data, listener)
  },
  onTerminalExit: (cb: (e: TerminalExitEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: TerminalExitEvent): void => cb(payload)
    ipcRenderer.on(TERM.exit, listener)
    return () => ipcRenderer.off(TERM.exit, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
```

- [ ] **Step 7: Typecheck** — `pnpm typecheck` → clean. (`env.d.ts` picks up the new `Api` automatically.)

- [ ] **Step 8: Commit**

```bash
git add src/main/terminal/node-pty-spawner.ts src/main/ipc/terminal-handlers.ts src/preload/index.ts src/main/ipc/terminal-handlers.test.ts
git commit -m "feat(terminal): ipc handlers, node-pty adapter, preload terminal api"
```

---

### Task 4: Wire terminals into main

**Files:**
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `registerTerminalIpc`, `nodePtySpawner`, `BrowserWindow`.
- Produces: terminal IPC registered against the focused window's `webContents`; all PTYs killed on quit. No new tests (integration wiring; covered by build + Task 3 unit tests). Verify with `pnpm build`.

- [ ] **Step 1: Update `src/main/index.ts`** — add the terminal wiring. The full file:

```ts
import { app, BrowserWindow, session } from 'electron'
import { join } from 'node:path'
import { loadConfig } from './config/load'
import { JiraClient } from './jira/client'
import { registerIpc } from './ipc/handlers'
import { registerTerminalIpc } from './ipc/terminal-handlers'
import { nodePtySpawner } from './terminal/node-pty-spawner'
import type { Config } from './config/schema'
import type { TerminalManager } from './terminal/manager'

function resolveConfigPath(): string {
  return process.env.SENIORDEV_CONFIG ?? join(app.getPath('userData'), 'config.yaml')
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
  if (loadedConfig) {
    terminals = registerTerminalIpc(
      loadedConfig,
      () => BrowserWindow.getFocusedWindow()?.webContents ?? BrowserWindow.getAllWindows()[0]?.webContents,
      nodePtySpawner
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
```

- [ ] **Step 2: Typecheck + build** — `pnpm typecheck` → clean; `pnpm build` → all three bundles build. (Interactive PTY behaviour is user-verified at runtime; Electron isn't runnable in CI.)

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(terminal): wire terminal ipc + node-pty into main, kill PTYs on quit"
```

---

### Task 5: Right panel — terminal tabs + xterm.js (design task)

**Files:**
- Modify: `src/renderer/src/App.vue`, `src/renderer/src/components/LeftPanel.vue`
- Create: `src/renderer/src/components/RightPanel.vue`, `src/renderer/src/components/TerminalView.vue`
- Delete: `src/renderer/src/components/RightPanelPlaceholder.vue`
- Test: `src/renderer/src/components/RightPanel.test.ts`

**Interfaces:**
- Consumes: `window.api.spawnTerminal/writeTerminal/resizeTerminal/killTerminal/onTerminalData/onTerminalExit`, `@xterm/xterm`, `@xterm/addon-fit`.
- Produces: right panel with N terminal tabs; "New session" spawns an interactive terminal for the active ticket's repo. `App.vue` holds `activeTicketKey` (from LeftPanel's emit) and passes it to `RightPanel`.
- Note: `TerminalView` (xterm) cannot be unit-tested under jsdom (canvas). Tests stub it and cover tab management only; TerminalView is build- + runtime-verified.

- [ ] **Step 1: LeftPanel emits active-ticket key** — in `src/renderer/src/components/LeftPanel.vue`, add to `<script setup>` (after the imports/refs):

```ts
import { computed, ref, watch } from 'vue'
```
and after `const activeKey = ref<string | null>(null)` add:
```ts
const emit = defineEmits<{ (e: 'active-ticket', key: string | null): void }>()
watch(activeKey, (k) => emit('active-ticket', k))
```
(Keep everything else in LeftPanel unchanged.)

- [ ] **Step 2: App holds activeTicketKey** — replace `src/renderer/src/App.vue`

```vue
<script setup lang="ts">
import { ref } from 'vue'
import LeftPanel from './components/LeftPanel.vue'
import RightPanel from './components/RightPanel.vue'

const activeTicketKey = ref<string | null>(null)
</script>

<template>
  <div class="shell">
    <LeftPanel @active-ticket="activeTicketKey = $event" />
    <RightPanel :active-ticket-key="activeTicketKey" />
  </div>
</template>
```

- [ ] **Step 3: Write `TerminalView.vue`** — `src/renderer/src/components/TerminalView.vue`

```vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const props = defineProps<{ id: string; ticketKey: string | null }>()
const host = ref<HTMLDivElement | null>(null)
let term: Terminal | null = null
let fit: FitAddon | null = null
let offData: (() => void) | null = null
let offExit: (() => void) | null = null
let ro: ResizeObserver | null = null

onMounted(async () => {
  term = new Terminal({ fontFamily: 'Consolas, monospace', fontSize: 13, cursorBlink: true, theme: { background: '#1a1f1d' } })
  fit = new FitAddon()
  term.loadAddon(fit)
  term.open(host.value!)
  fit.fit()

  term.onData((d) => window.api.writeTerminal(props.id, d))
  offData = window.api.onTerminalData((e) => { if (e.id === props.id) term?.write(e.data) })
  offExit = window.api.onTerminalExit((e) => { if (e.id === props.id) term?.write(`\r\n[process exited: ${e.exitCode}]\r\n`) })

  const res = await window.api.spawnTerminal({
    id: props.id,
    ticketKey: props.ticketKey ?? undefined,
    cols: term.cols,
    rows: term.rows
  })
  if (!res.ok) term.write(`\r\n[failed to start: ${res.error}]\r\n`)

  ro = new ResizeObserver(() => {
    fit?.fit()
    if (term) window.api.resizeTerminal(props.id, term.cols, term.rows)
  })
  ro.observe(host.value!)
})

onBeforeUnmount(() => {
  offData?.()
  offExit?.()
  ro?.disconnect()
  window.api.killTerminal(props.id)
  term?.dispose()
})
</script>

<template>
  <div ref="host" class="terminal-host"></div>
</template>

<style scoped>
.terminal-host { width: 100%; height: 100%; }
</style>
```

- [ ] **Step 4: Write the failing RightPanel test** — `src/renderer/src/components/RightPanel.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import RightPanel from './RightPanel.vue'

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    spawnTerminal: vi.fn(async () => ({ ok: true })),
    writeTerminal: vi.fn(), resizeTerminal: vi.fn(), killTerminal: vi.fn(),
    onTerminalData: vi.fn(() => () => {}), onTerminalExit: vi.fn(() => () => {})
  }
})

const stubs = { TerminalView: { props: ['id', 'ticketKey'], template: '<div class="tv" :data-id="id" />' } }

describe('RightPanel', () => {
  it('starts with no terminals and an empty state', () => {
    const w = mount(RightPanel, { props: { activeTicketKey: null }, global: { stubs } })
    expect(w.findAll('.term-tab')).toHaveLength(0)
    expect(w.text()).toContain('New session')
  })

  it('opens a terminal tab on New session', async () => {
    const w = mount(RightPanel, { props: { activeTicketKey: 'PROJ-1' }, global: { stubs } })
    await w.find('.new-session').trigger('click')
    expect(w.findAll('.term-tab')).toHaveLength(1)
    expect(w.findAll('.tv')).toHaveLength(1)
  })

  it('opens multiple tabs and closes one', async () => {
    const w = mount(RightPanel, { props: { activeTicketKey: null }, global: { stubs } })
    await w.find('.new-session').trigger('click')
    await w.find('.new-session').trigger('click')
    expect(w.findAll('.term-tab')).toHaveLength(2)
    await w.findAll('.term-tab__close')[0].trigger('click')
    expect(w.findAll('.term-tab')).toHaveLength(1)
  })
})
```

- [ ] **Step 5: Run to verify it fails** — `pnpm test src/renderer/src/components/RightPanel.test.ts` → FAIL.

- [ ] **Step 6: Write `RightPanel.vue`** — `src/renderer/src/components/RightPanel.vue`

```vue
<script setup lang="ts">
import { ref } from 'vue'
import TerminalView from './TerminalView.vue'

defineProps<{ activeTicketKey: string | null }>()

interface Term { id: string; title: string }
const terms = ref<Term[]>([])
const activeId = ref<string | null>(null)
let counter = 0

function newSession(): void {
  counter += 1
  const id = `t${counter}-${Date.now()}`
  terms.value.push({ id, title: `Session ${counter}` })
  activeId.value = id
}

function closeTerm(id: string): void {
  const i = terms.value.findIndex((t) => t.id === id)
  if (i === -1) return
  terms.value.splice(i, 1)
  if (activeId.value === id) activeId.value = terms.value.at(-1)?.id ?? null
}
</script>

<template>
  <section class="right-panel">
    <div class="term-bar">
      <nav class="term-tabs">
        <button
          v-for="t in terms"
          :key="t.id"
          class="term-tab"
          :class="{ 'term-tab--active': t.id === activeId }"
          @click="activeId = t.id"
        >
          {{ t.title }}
          <span class="term-tab__close" @click.stop="closeTerm(t.id)">×</span>
        </button>
      </nav>
      <button class="new-session" @click="newSession">+ New session</button>
    </div>

    <div class="term-body">
      <div v-if="!terms.length" class="panel-empty">No sessions — start one with “New session”.</div>
      <div
        v-for="t in terms"
        v-show="t.id === activeId"
        :key="t.id"
        class="term-slot"
      >
        <TerminalView :id="t.id" :ticket-key="activeTicketKey" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.term-bar { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--hairline); }
.term-tabs { display: flex; gap: 4px; flex: 1; flex-wrap: wrap; }
.term-tab {
  background: var(--surface); color: var(--ink-soft);
  border: 1px solid var(--hairline); border-radius: var(--radius-sm);
  padding: 5px 10px; cursor: pointer;
}
.term-tab--active { background: var(--surface-2); color: var(--ink); }
.term-tab__close { margin-left: 6px; color: var(--ink-muted); }
.new-session {
  background: var(--teal); color: var(--bg); border: 0;
  border-radius: var(--radius-sm); padding: 6px 12px; cursor: pointer; font-weight: 600; white-space: nowrap;
}
.new-session:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.term-body { flex: 1; position: relative; overflow: hidden; }
.term-slot { position: absolute; inset: 0; padding: 6px; }
</style>
```

- [ ] **Step 7: Delete the placeholder** — remove `src/renderer/src/components/RightPanelPlaceholder.vue`.

- [ ] **Step 8: Run to verify it passes** — `pnpm test src/renderer/src/components/RightPanel.test.ts` → PASS (3).

- [ ] **Step 9: Full gate** — `pnpm test` (all pass), `pnpm typecheck` (clean), `pnpm build` (bundles). Report counts vs baseline.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/App.vue src/renderer/src/components/LeftPanel.vue src/renderer/src/components/RightPanel.vue src/renderer/src/components/TerminalView.vue src/renderer/src/components/RightPanel.test.ts
git rm src/renderer/src/components/RightPanelPlaceholder.vue
git commit -m "feat(ui): right-panel terminal multiplexer with xterm.js sessions"
```

---

## Self-Review

**Spec coverage (Phase 2):** terminal-manager (Task 2) ✓; xterm.js tabs + multiplexer (Task 5) ✓; spawn CLI in resolved cwd (Tasks 1,3,4) ✓; multiple tabs (Task 5) ✓; ticket→repo cwd resolution (Task 1) + per-terminal override supported by `cwdOverride` in the request type ✓. Deferred (spec, later phases): YOLO/prompt injection (Phase 4), branch auto-create, PR detection.

**Placeholder scan:** every code step is complete; commands have expected outcomes.

**Type consistency:** `PtySpawner`/`PtyProcess`/`SpawnOptions` defined in `manager.ts` (Task 2), consumed by `node-pty-spawner.ts` and `terminal-handlers.ts` (Task 3). `TERM`, `SpawnTerminalRequest`, `SpawnResult`, `TerminalDataEvent`, `TerminalExitEvent` defined in `shared/ipc.ts` (Task 1), used by handlers (Task 3), preload (Task 3), and components (Task 5). `buildInteractiveLaunch` signature (Task 1) matches its call in Task 3. `registerTerminalIpc(config, getSender, spawner)` (Task 3) matches its call in Task 4.

**Native isolation check:** `node-pty` imported only in `node-pty-spawner.ts` (Task 3 Step 1) and `main/index.ts` (Task 4) — neither is imported by any test. Handler tests inject a fake spawner. ✓
