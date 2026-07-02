# SeniorDev Phase 5 — CLI Launch Args + Packaging — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps. Workers make file edits only; orchestrator runs all tests/typecheck/build/git.

**Goal:** Launch with tickets + a starting mode/prompt/tool from the command line (`seniordev PROJ-123 --yolo fix-bug`), auto-opening ticket tabs and (optionally) a first session at boot. Package the app into installers via electron-builder.

**Architecture:** Main parses `process.argv` into `StartupOptions` (pure, injected file-reader for `--prompt @file`), exposes it over a `startup:get` IPC. On load the renderer fetches it, opens each ticket in the left panel, and — if a session directive is present — starts one session in the right panel. electron-builder config produces Win/Mac/Linux artifacts from the existing `build/icon.png`.

**Tech Stack:** electron-builder (new devDep). No other new deps.

## Global Constraints

- **pnpm**; `pnpm test`/`typecheck`/`build`. Branch `feat/phase5-cli-packaging` off `develop`. No AI-attribution in commits.
- **Native isolation preserved:** no test-imported module imports `node-pty`.
- **CLI grammar:** `seniordev [tickets...] [--interactive] [--yolo <prompt-name>] [--prompt <text|@file>] [--tool <name>]`. Tickets are positionals matching `^[A-Za-z][A-Za-z0-9]*-\d+$` (case-insensitive, uppercased) — this ignores Electron/dev argv noise (paths don't match). A session is started only if a session flag (`--interactive`/`--yolo`/`--prompt`/`--tool`) is present; `--yolo` ⇒ yolo mode + prompt name; otherwise interactive.
- **Parser purity:** `parseStartupArgs(argv, readFile)` takes an injected `readFile` so the `@file` path is testable without fs.
- **Packaging is config + build-verified only here** (Electron binary can't run in this env); installer generation is the user's step. Do not run electron-builder in the gate.
- **Interfaces (do not break):** `LeftPanel` opens tickets via its key input; `RightPanel.startSession({prompt?, yolo?})`; `SpawnTerminalRequest` already has `tool?`. `window.api` gains `getStartup`.

## File Structure (Phase 5)

```
src/shared/ipc.ts                    (MODIFY: StartupOptions, StartupSession, STARTUP)
src/main/cli/parse-args.ts           (NEW: parseStartupArgs)
src/main/ipc/startup-handlers.ts     (NEW: registerStartupIpc)
src/preload/index.ts                 (MODIFY: getStartup)
src/main/index.ts                    (MODIFY: parse argv, register startup ipc)
src/renderer/src/App.vue             (MODIFY: fetch startup, drive panels via refs)
src/renderer/src/components/LeftPanel.vue     (MODIFY: expose openTickets)
src/renderer/src/components/RightPanel.vue    (MODIFY: expose startStartupSession; thread tool)
src/renderer/src/components/TerminalView.vue  (MODIFY: tool prop -> spawn)
electron-builder.yml                 (NEW)
package.json                         (MODIFY: electron-builder devDep + dist scripts)
README.md                            (NEW: brief usage + build docs)
```

---

### Task 1: CLI arg parser

**Files:** Modify `src/shared/ipc.ts`; Create `src/main/cli/parse-args.ts`, `src/main/cli/parse-args.test.ts`

**Interfaces:**
- In `shared/ipc.ts`: `interface StartupSession { mode: 'interactive'|'yolo'; promptName?: string; promptText?: string; tool?: string }`; `interface StartupOptions { tickets: string[]; session?: StartupSession }`; `const STARTUP = { get: 'startup:get' } as const`.
- `parseStartupArgs(argv: string[], readFile: (p: string) => string): StartupOptions`

- [ ] **Step 1: Extend `src/shared/ipc.ts`** — append:

```ts
export interface StartupSession {
  mode: 'interactive' | 'yolo'
  promptName?: string
  promptText?: string
  tool?: string
}
export interface StartupOptions {
  tickets: string[]
  session?: StartupSession
}
export const STARTUP = { get: 'startup:get' } as const
```

- [ ] **Step 2: Failing test** — `src/main/cli/parse-args.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest'
import { parseStartupArgs } from './parse-args'

const noRead = () => { throw new Error('should not read') }

describe('parseStartupArgs', () => {
  it('collects ticket positionals (uppercased) and ignores argv noise', () => {
    const o = parseStartupArgs(['C:/electron.exe', 'proj-12', 'AB-3', '/some/path', '--flagless'], noRead)
    expect(o.tickets).toEqual(['PROJ-12', 'AB-3'])
    expect(o.session).toBeUndefined()
  })
  it('parses --yolo <name> into a yolo session', () => {
    const o = parseStartupArgs(['PROJ-1', '--yolo', 'fix-bug'], noRead)
    expect(o.tickets).toEqual(['PROJ-1'])
    expect(o.session).toEqual({ mode: 'yolo', promptName: 'fix-bug', promptText: undefined, tool: undefined })
  })
  it('parses --prompt inline text as an interactive session', () => {
    const o = parseStartupArgs(['--prompt', 'do the thing'], noRead)
    expect(o.session?.mode).toBe('interactive')
    expect(o.session?.promptText).toBe('do the thing')
  })
  it('reads --prompt @file via the injected reader', () => {
    const read = vi.fn(() => 'FILE BODY')
    const o = parseStartupArgs(['--prompt', '@C:/p.md'], read)
    expect(read).toHaveBeenCalledWith('C:/p.md')
    expect(o.session?.promptText).toBe('FILE BODY')
  })
  it('parses --tool and --interactive', () => {
    const o = parseStartupArgs(['PROJ-9', '--interactive', '--tool', 'codex'], noRead)
    expect(o.session).toEqual({ mode: 'interactive', promptName: undefined, promptText: undefined, tool: 'codex' })
  })
})
```

- [ ] **Step 3: Run → FAIL**

- [ ] **Step 4: Implement** — `src/main/cli/parse-args.ts`

```ts
import type { StartupOptions } from '../../shared/ipc'

const TICKET = /^[A-Za-z][A-Za-z0-9]*-\d+$/

export function parseStartupArgs(argv: string[], readFile: (p: string) => string): StartupOptions {
  const tickets: string[] = []
  let mode: 'interactive' | 'yolo' | undefined
  let promptName: string | undefined
  let promptText: string | undefined
  let tool: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--interactive') mode = mode ?? 'interactive'
    else if (a === '--yolo') { mode = 'yolo'; promptName = argv[++i] }
    else if (a === '--tool') tool = argv[++i]
    else if (a === '--prompt') {
      const v = argv[++i] ?? ''
      promptText = v.startsWith('@') ? readFile(v.slice(1)) : v
    } else if (!a.startsWith('-') && TICKET.test(a)) {
      tickets.push(a.toUpperCase())
    }
  }

  const hasSession =
    mode !== undefined || promptName !== undefined || promptText !== undefined || tool !== undefined
  const session = hasSession ? { mode: mode ?? 'interactive', promptName, promptText, tool } : undefined
  return { tickets, session }
}
```

- [ ] **Step 5: Run → PASS** (5)

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc.ts src/main/cli/parse-args.ts src/main/cli/parse-args.test.ts
git commit -m "feat(cli): startup arg parser (tickets + session directives)"
```

---

### Task 2: Startup IPC + renderer boot wiring

**Files:**
- Create: `src/main/ipc/startup-handlers.ts`, `src/main/ipc/startup-handlers.test.ts`
- Modify: `src/preload/index.ts`, `src/main/index.ts`, `src/renderer/src/App.vue`, `src/renderer/src/components/LeftPanel.vue`, `src/renderer/src/components/RightPanel.vue`, `src/renderer/src/components/TerminalView.vue`
- Test: `src/renderer/src/components/LeftPanel.test.ts` (extend), `src/renderer/src/components/RightPanel.test.ts` (extend)

**Interfaces:**
- `registerStartupIpc(options: StartupOptions): void` — `startup:get` returns the options.
- `window.api.getStartup(): Promise<StartupOptions>`.
- `LeftPanel` exposes `openTickets(keys: string[]): Promise<void>` (opens each, sets active to the first).
- `RightPanel` exposes `startStartupSession(s: StartupSession): void`; `RightPanel.startSession` + `Term` + `TerminalView` thread an optional `tool`.

- [ ] **Step 1: `startup-handlers.ts`**

```ts
import { ipcMain } from 'electron'
import { STARTUP, type StartupOptions } from '../../shared/ipc'

export function registerStartupIpc(options: StartupOptions): void {
  ipcMain.handle(STARTUP.get, (): StartupOptions => options)
}
```

- [ ] **Step 2: `startup-handlers.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const handleMap = new Map<string, (...a: unknown[]) => unknown>()
vi.mock('electron', () => ({ ipcMain: { handle: (c: string, f: (...a: unknown[]) => unknown) => handleMap.set(c, f) } }))
import { registerStartupIpc } from './startup-handlers'
beforeEach(() => handleMap.clear())

describe('registerStartupIpc', () => {
  it('returns the parsed startup options', async () => {
    const opts = { tickets: ['PROJ-1'], session: { mode: 'yolo' as const, promptName: 'fix' } }
    registerStartupIpc(opts)
    expect(await handleMap.get('startup:get')!()).toEqual(opts)
  })
})
```

- [ ] **Step 3: Run → PASS** (1)

- [ ] **Step 4: Preload** — in `src/preload/index.ts` add `STARTUP` to the shared-ipc import and to `api`:
```ts
  getStartup: (): Promise<import('../shared/ipc').StartupOptions> => ipcRenderer.invoke(STARTUP.get),
```

- [ ] **Step 5: Main wiring** — in `src/main/index.ts`:
```ts
import { readFileSync } from 'node:fs'
import { parseStartupArgs } from './cli/parse-args'
import { registerStartupIpc } from './ipc/startup-handlers'
```
In `app.whenReady()`, after `registerShellIpc()`:
```ts
  registerStartupIpc(parseStartupArgs(process.argv.slice(1), (p) => readFileSync(p, 'utf8')))
```

- [ ] **Step 6: LeftPanel exposes openTickets** — in `src/renderer/src/components/LeftPanel.vue`, refactor `openTicket` to delegate to a reusable `openKey`, and expose `openTickets`. Replace the `openTicket` function with:

```ts
async function openKey(rawKey: string): Promise<void> {
  const key = rawKey.trim().toUpperCase()
  error.value = null
  if (!key) return
  const existing = tabs.value.find((t) => t.key === key)
  if (existing) { activeKey.value = existing.key; return }
  const res = await window.api.getTicket(key)
  if (res.ok) { tabs.value.push(res.ticket); activeKey.value = res.ticket.key }
  else { error.value = res.error }
}

async function openTicket(): Promise<void> {
  const key = keyInput.value
  await openKey(key)
  keyInput.value = ''
}

async function openTickets(keys: string[]): Promise<void> {
  for (const k of keys) await openKey(k)
  if (keys.length) activeKey.value = keys[0].toUpperCase()
}

defineExpose({ openTickets })
```
(Keep `closeTab`, `activeTicket`, the emit/watch, and the template unchanged.)

- [ ] **Step 7: RightPanel exposes startStartupSession + threads tool** — in `src/renderer/src/components/RightPanel.vue`:

Change `Term` and `startSession` to carry `tool`, and add the startup method:
```ts
interface Term { id: string; title: string; prompt?: { name?: string; text?: string }; yolo?: boolean; tool?: string }
```
```ts
function startSession(payload: { prompt?: { name?: string; text?: string }; yolo?: boolean; tool?: string }): void {
  counter += 1
  const id = `t${counter}-${Date.now()}`
  const base = payload.prompt?.name ?? (payload.yolo ? 'yolo' : 'Session')
  terms.value.push({ id, title: `${base} ${counter}`, prompt: payload.prompt, yolo: payload.yolo, tool: payload.tool })
  activeId.value = id
}

function startStartupSession(s: { mode: 'interactive' | 'yolo'; promptName?: string; promptText?: string; tool?: string }): void {
  const prompt = s.promptName ? { name: s.promptName } : s.promptText ? { text: s.promptText } : undefined
  startSession({ prompt, yolo: s.mode === 'yolo', tool: s.tool })
}

defineExpose({ startStartupSession })
```
Pass `:tool` to TerminalView in the template:
```html
<TerminalView :id="t.id" :ticket-key="activeTicketKey" :prompt="t.prompt" :yolo="t.yolo" :tool="t.tool" />
```

- [ ] **Step 8: TerminalView threads tool** — in `src/renderer/src/components/TerminalView.vue`, add `tool?: string` to `defineProps` and `tool: props.tool` to the `spawnTerminal({ … })` object.

- [ ] **Step 9: App drives panels** — replace `src/renderer/src/App.vue`:

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import LeftPanel from './components/LeftPanel.vue'
import RightPanel from './components/RightPanel.vue'

const activeTicketKey = ref<string | null>(null)
const leftPanel = ref<InstanceType<typeof LeftPanel> | null>(null)
const rightPanel = ref<InstanceType<typeof RightPanel> | null>(null)

onMounted(async () => {
  const startup = await window.api.getStartup()
  if (startup.tickets.length) {
    await leftPanel.value?.openTickets(startup.tickets)
    activeTicketKey.value = startup.tickets[0]
  }
  if (startup.session) rightPanel.value?.startStartupSession(startup.session)
})
</script>

<template>
  <div class="shell">
    <LeftPanel ref="leftPanel" @active-ticket="activeTicketKey = $event" />
    <RightPanel ref="rightPanel" :active-ticket-key="activeTicketKey" />
  </div>
</template>
```

- [ ] **Step 10: Extend LeftPanel test** — `src/renderer/src/components/LeftPanel.test.ts`: add
```ts
  it('opens a list of tickets via the exposed openTickets', async () => {
    const w = mount(LeftPanel)
    await (w.vm as unknown as { openTickets: (k: string[]) => Promise<void> }).openTickets(['PROJ-1', 'PROJ-2'])
    await flushPromises()
    expect(w.findAll('.tab')).toHaveLength(2)
  })
```

- [ ] **Step 11: Extend RightPanel test** — add `getStartup` to the api mock (`vi.fn(async () => ({ tickets: [] }))`) and:
```ts
  it('starts a session from startStartupSession', async () => {
    const w = mount(RightPanel, { props: { activeTicketKey: null }, global: { stubs } })
    ;(w.vm as unknown as { startStartupSession: (s: unknown) => void }).startStartupSession({ mode: 'yolo', promptName: 'ship-it' })
    await w.vm.$nextTick()
    expect(w.text()).toContain('ship-it')
  })
```

- [ ] **Step 12: Full gate** — `pnpm test`, `pnpm typecheck`, `pnpm build`. Report vs baseline.

- [ ] **Step 13: Commit**

```bash
git add src/main/ipc/startup-handlers.ts src/main/ipc/startup-handlers.test.ts src/preload/index.ts src/main/index.ts src/renderer/src/App.vue src/renderer/src/components/LeftPanel.vue src/renderer/src/components/LeftPanel.test.ts src/renderer/src/components/RightPanel.vue src/renderer/src/components/RightPanel.test.ts src/renderer/src/components/TerminalView.vue
git commit -m "feat(cli): boot with tickets + session from the command line"
```

---

### Task 3: Packaging (electron-builder)

**Files:** Create `electron-builder.yml`, `README.md`; Modify `package.json`

**Interfaces:** `pnpm dist` builds installers; `pnpm dist:dir` builds an unpacked app dir. Not run in the gate (needs the Electron binary); documented as the user's step.

- [ ] **Step 1: Add electron-builder devDep + scripts** — in `package.json`, add to `devDependencies`:
```json
    "electron-builder": "^24.13.0"
```
and to `scripts`:
```json
    "dist": "electron-vite build && electron-builder",
    "dist:dir": "electron-vite build && electron-builder --dir"
```

- [ ] **Step 2: Write `electron-builder.yml`**

```yaml
appId: com.boxofraccoons.seniordev
productName: SeniorDev
directories:
  buildResources: build
  output: release
files:
  - out/**
  - package.json
win:
  target: nsis
  icon: build/icon.png
mac:
  target: dmg
  category: public.app-category.developer-tools
  icon: build/icon.png
linux:
  target: AppImage
  category: Development
  icon: build/icon.png
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

- [ ] **Step 3: Write `README.md`**

```markdown
# SeniorDev

A cross-platform desktop workbench: a tabbed Jira ticket reader (left) and a tabbed interactive CLI-agent terminal multiplexer (right). Read a ticket, spin up a Claude Code / Codex session in the mapped repo, or "YOLO" a prebuilt prompt that ends in a PR.

## Configure

Copy `config.example.yaml` to your OS config dir and fill it in:

- Windows: `%APPDATA%/SeniorDev/config.yaml`
- macOS/Linux: `~/.config/SeniorDev/config.yaml`

Prompts live in `promptsDir` (default `~/.config/SeniorDev/prompts`), one markdown file per prompt with `name`/`description` frontmatter and `{{ticket.*}}` / `{{forge.*}}` placeholders.

## Develop

```bash
pnpm install
pnpm dev          # launch the app (electron-vite)
pnpm test         # vitest
pnpm typecheck
```

> node-pty is native; on first run electron-builder/electron-rebuild aligns it to the Electron ABI.

## Command line

```
seniordev [tickets...] [--interactive] [--yolo <prompt>] [--prompt <text|@file>] [--tool <name>]
```

- `seniordev PROJ-123 PROJ-124` — open both tickets.
- `seniordev PROJ-123 --yolo fix-bug` — open the ticket and auto-run the `fix-bug` prompt with bypassed permissions.
- `--tool codex` — override the default CLI tool.

## Package

```bash
pnpm dist         # installers into release/ (per-OS: NSIS / dmg / AppImage)
pnpm dist:dir     # unpacked app dir
```
```

- [ ] **Step 4: Install + gate** — orchestrator runs `pnpm install` (adds electron-builder), then `pnpm test` + `pnpm typecheck` + `pnpm build` (electron-vite) to confirm nothing regressed. Do NOT run `pnpm dist` (needs a runnable Electron in this env).

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml electron-builder.yml README.md
git commit -m "chore(dist): electron-builder packaging config + README"
```

---

## Self-Review

**Spec coverage (Phase 5):** CLI grammar tickets + `--interactive`/`--yolo`/`--prompt`(text/@file)/`--tool` (Task 1) ✓; startup opens ticket tabs + a session (Task 2) ✓; packaging via electron-builder for Win/Mac/Linux from build/icon.png (Task 3) ✓.

**Placeholder scan:** complete code in each step; commands have expected outcomes.

**Type consistency:** `StartupOptions`/`StartupSession`/`STARTUP` (Task 1, shared/ipc.ts) consumed by `parseStartupArgs` (Task 1), `registerStartupIpc` (Task 2), preload `getStartup` (Task 2), and App (Task 2). `LeftPanel.openTickets(keys)` + `RightPanel.startStartupSession(s)` exposed (Task 2) match their App calls (Task 2 Step 9). `tool` threads `startSession`→`Term`→`TerminalView`→`SpawnTerminalRequest.tool` (already exists).

**Native isolation:** unchanged — `parse-args.ts`/`startup-handlers.ts` import only shared/electron; no `node-pty`.

**Packaging caveat:** `pnpm dist` is not run in the gate (no runnable Electron here); it is the user's verification step, and node-pty needs the Electron-ABI rebuild that electron-builder triggers.
