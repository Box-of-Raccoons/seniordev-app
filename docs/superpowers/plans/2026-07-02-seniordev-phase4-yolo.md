# SeniorDev Phase 4 — YOLO + PR Detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps. Workers make file edits only; orchestrator runs all tests/typecheck/build/git.

**Goal:** A "YOLO" session runs the chosen prebuilt prompt with the tool's bypass-permission args, watched live; the app scans the terminal stream for a PR/MR URL and surfaces a "PR ready" card with an Open button.

**Architecture:** YOLO reuses the Phase-3 prompt path but swaps `interactiveArgs`→`yoloArgs`. A `PrDetector` (main) buffers each yolo session's output and matches it against every configured forge's `urlPattern`; the first hit emits a `pty:pr` event. The renderer shows a PR-ready card per tab; Open calls a scheme-validated `shell:openExternal`.

**Tech Stack:** existing. No new deps.

## Global Constraints

- **pnpm**; `pnpm test`/`typecheck`/`build`. Branch `feat/phase4-yolo` off `develop`. No AI-attribution in commits.
- **Native isolation preserved:** no test-imported module imports `node-pty`.
- **YOLO = visible auto-run terminal:** same live terminal, but launched with `cliTools[tool].yoloArgs` (e.g. `['--permission-mode','bypassPermissions']`) and an auto-delivered prompt. The app does NOT run git; the prompt's own `gh`/`glab` opens the PR.
- **PR detection is a heuristic on output.** Match against ALL configured forges' `urlPattern`s (robust to a wrong repo→forge mapping); the card's label uses the matched forge's `term`. Fire once per session.
- **Security:** `shell:openExternal` opens ONLY `http:`/`https:` URLs; anything else is rejected (never pass arbitrary terminal text to the OS opener).
- **Interfaces (do not break):** `buildInteractiveLaunch(config, opts, expandedPrompt?)` (session.ts), `registerTerminalIpc(config, getSender, spawner, deps)` (terminal-handlers.ts), `SpawnTerminalRequest` (shared/ipc.ts with `prompt?`), `TERM` const, `PrDetector` (new). `Config.forges: Record<string,{prCommand,term,urlPattern}>`.

## File Structure (Phase 4)

```
src/main/terminal/pr-detector.ts       (NEW: PrDetector, buildForgePatterns)
src/main/terminal/session.ts           (MODIFY: opts.yolo -> yoloArgs)
src/shared/ipc.ts                      (MODIFY: SpawnTerminalRequest.yolo, TERM.pr, TerminalPrEvent, SHELL.openExternal)
src/main/ipc/terminal-handlers.ts      (MODIFY: per-session PrDetector on yolo, emit pty:pr)
src/main/ipc/shell-handlers.ts         (NEW: registerShellIpc — validated openExternal)
src/preload/index.ts                   (MODIFY: yolo passes through; onTerminalPr, openExternal)
src/main/index.ts                      (MODIFY: register shell ipc)
src/renderer/src/components/NewSessionMenu.vue (MODIFY: Interactive|YOLO mode toggle)
src/renderer/src/components/RightPanel.vue     (MODIFY: carry yolo, pass to TerminalView)
src/renderer/src/components/TerminalView.vue   (MODIFY: yolo in spawn; PR-ready card)
```

---

### Task 1: PrDetector

**Files:** Create `src/main/terminal/pr-detector.ts`, `src/main/terminal/pr-detector.test.ts`

**Interfaces:**
- `interface ForgePattern { term: string; regex: RegExp }`
- `buildForgePatterns(config: Config): ForgePattern[]` — compiles each `config.forges[*].urlPattern` to a RegExp (skips invalid patterns).
- `class PrDetector { constructor(patterns: ForgePattern[], maxBuffer?: number); feed(chunk: string): { url: string; term: string } | null }` — accumulates a bounded tail buffer, returns the first match once, then always null.

- [ ] **Step 1: Failing test** — `src/main/terminal/pr-detector.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { PrDetector, buildForgePatterns, type ForgePattern } from './pr-detector'
import type { Config } from '../config/schema'

const patterns: ForgePattern[] = [
  { term: 'PR', regex: /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/ },
  { term: 'MR', regex: /https:\/\/gitlab\.com\/.+\/-\/merge_requests\/\d+/ }
]

describe('PrDetector', () => {
  it('detects a github PR url and its term, once', () => {
    const d = new PrDetector(patterns)
    expect(d.feed('working...\n')).toBeNull()
    const hit = d.feed('Created https://github.com/org/repo/pull/42\n')
    expect(hit).toEqual({ url: 'https://github.com/org/repo/pull/42', term: 'PR' })
    expect(d.feed('https://github.com/org/repo/pull/99')).toBeNull() // already found
  })
  it('detects a url split across two chunks', () => {
    const d = new PrDetector(patterns)
    expect(d.feed('see https://github.com/org/re')).toBeNull()
    expect(d.feed('po/pull/7 done')).toEqual({ url: 'https://github.com/org/repo/pull/7', term: 'PR' })
  })
  it('labels gitlab MRs with the MR term', () => {
    const d = new PrDetector(patterns)
    expect(d.feed('https://gitlab.com/g/p/-/merge_requests/3')?.term).toBe('MR')
  })
})

describe('buildForgePatterns', () => {
  it('compiles configured forge urlPatterns and skips invalid ones', () => {
    const cfg = {
      forges: {
        github: { prCommand: '', term: 'PR', urlPattern: 'https://github\\.com/[^/]+/[^/]+/pull/\\d+' },
        bad: { prCommand: '', term: 'X', urlPattern: '(' }
      }
    } as unknown as Config
    const ps = buildForgePatterns(cfg)
    expect(ps).toHaveLength(1)
    expect(ps[0].term).toBe('PR')
    expect('https://github.com/o/r/pull/1').toMatch(ps[0].regex)
  })
}
)
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement** — `src/main/terminal/pr-detector.ts`

```ts
import type { Config } from '../config/schema'

export interface ForgePattern {
  term: string
  regex: RegExp
}

export function buildForgePatterns(config: Config): ForgePattern[] {
  const out: ForgePattern[] = []
  for (const forge of Object.values(config.forges ?? {})) {
    try {
      out.push({ term: forge.term, regex: new RegExp(forge.urlPattern) })
    } catch {
      // skip an invalid pattern rather than crashing the session
    }
  }
  return out
}

export class PrDetector {
  private buffer = ''
  private found = false

  constructor(
    private readonly patterns: ForgePattern[],
    private readonly maxBuffer = 8192
  ) {}

  feed(chunk: string): { url: string; term: string } | null {
    if (this.found) return null
    this.buffer = (this.buffer + chunk).slice(-this.maxBuffer)
    for (const p of this.patterns) {
      const m = this.buffer.match(p.regex)
      if (m) {
        this.found = true
        return { url: m[0], term: p.term }
      }
    }
    return null
  }
}
```

- [ ] **Step 4: Run → PASS** (4)

- [ ] **Step 5: Commit**

```bash
git add src/main/terminal/pr-detector.ts src/main/terminal/pr-detector.test.ts
git commit -m "feat(yolo): PR/MR url detector over configured forge patterns"
```

---

### Task 2: YOLO launch args

**Files:** Modify `src/main/terminal/session.ts`, `src/main/terminal/session.test.ts`, `src/shared/ipc.ts`

**Interfaces:** `buildInteractiveLaunch(config, opts, expandedPrompt?)` — `opts` gains `yolo?: boolean`; when true, base args = `tool.yoloArgs` (else `interactiveArgs`). `SpawnTerminalRequest` gains `yolo?: boolean`.

- [ ] **Step 1: Modify `session.ts`** — change the args line. Replace:
```ts
  const args = [...tool.interactiveArgs]
```
with:
```ts
  const args = [...(opts.yolo ? tool.yoloArgs : tool.interactiveArgs)]
```
and add `yolo?: boolean` to the `opts` param type:
```ts
  opts: { tool?: string; ticketKey?: string; cwdOverride?: string; yolo?: boolean },
```

- [ ] **Step 2: Extend `session.test.ts`** — append inside the describe:

```ts
  it('uses yoloArgs when yolo is set', () => {
    const l = buildInteractiveLaunch(cfg, { tool: 'claude', yolo: true }, 'GO')
    expect(l.args).toEqual(['--permission-mode', 'bypassPermissions'])
    expect(l.stdinPrompt).toBe('GO')
  })
```
(The file's `cfg.claude` has `yoloArgs: ['--permission-mode', 'bypassPermissions']` and `promptDelivery: 'stdin'`.)

- [ ] **Step 3: Run → PASS** — `pnpm test src/main/terminal/session.test.ts` (7)

- [ ] **Step 4: Extend `src/shared/ipc.ts`** — add `yolo?: boolean` to the `SpawnTerminalRequest` interface (alongside `prompt?`). Then append the PR + shell additions:

```ts
export interface TerminalPrEvent { id: string; url: string; term: string }
export const SHELL = { openExternal: 'shell:openExternal' } as const
```
and add `pr: 'pty:pr'` to the existing `TERM` const object.

- [ ] **Step 5: Commit**

```bash
git add src/main/terminal/session.ts src/main/terminal/session.test.ts src/shared/ipc.ts
git commit -m "feat(yolo): yolo launch args + pr/shell ipc types"
```

---

### Task 3: Wire PR detection + shell openExternal

**Files:**
- Modify: `src/main/ipc/terminal-handlers.ts`, `src/preload/index.ts`, `src/main/index.ts`
- Create: `src/main/ipc/shell-handlers.ts`, `src/main/ipc/shell-handlers.test.ts`
- Test: `src/main/ipc/terminal-handlers.test.ts` (extend)

**Interfaces:**
- Terminal handler: for a `req.yolo` spawn, create a per-session `PrDetector`; in `onData`, feed it and on a hit `getSender().send(TERM.pr, { id, url, term })`; clear on exit.
- `registerShellIpc(): void` registers `shell:openExternal` — opens only http/https via Electron `shell.openExternal`, returns `{ ok: boolean }`.
- `window.api.onTerminalPr(cb): ()=>void`; `window.api.openExternal(url): Promise<{ok:boolean}>`.

- [ ] **Step 1: Write `src/main/ipc/shell-handlers.ts`**

```ts
import { ipcMain, shell } from 'electron'
import { SHELL } from '../../shared/ipc'

export function registerShellIpc(): void {
  ipcMain.handle(SHELL.openExternal, async (_e, url: string): Promise<{ ok: boolean }> => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return { ok: false }
    await shell.openExternal(url)
    return { ok: true }
  })
}
```

- [ ] **Step 2: Write `src/main/ipc/shell-handlers.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const handleMap = new Map<string, (...a: unknown[]) => unknown>()
const openExternal = vi.fn(async () => {})
vi.mock('electron', () => ({
  ipcMain: { handle: (c: string, f: (...a: unknown[]) => unknown) => handleMap.set(c, f) },
  shell: { openExternal: (url: string) => openExternal(url) }
}))

import { registerShellIpc } from './shell-handlers'

beforeEach(() => { handleMap.clear(); openExternal.mockClear() })

describe('registerShellIpc', () => {
  it('opens http(s) urls', async () => {
    registerShellIpc()
    const res = await handleMap.get('shell:openExternal')!({}, 'https://github.com/o/r/pull/1')
    expect(res).toEqual({ ok: true })
    expect(openExternal).toHaveBeenCalledWith('https://github.com/o/r/pull/1')
  })
  it('rejects non-http schemes without opening', async () => {
    registerShellIpc()
    const res = await handleMap.get('shell:openExternal')!({}, 'file:///etc/passwd')
    expect(res).toEqual({ ok: false })
    expect(openExternal).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Update `terminal-handlers.ts`** — add imports and per-session detection. Add imports:
```ts
import { PrDetector, buildForgePatterns } from '../terminal/pr-detector'
```
Inside `registerTerminalIpc`, before creating the manager, add:
```ts
  const detectors = new Map<string, PrDetector>()
```
Change the manager's `onData`/`onExit` callbacks to:
```ts
  const manager = new TerminalManager(spawner, {
    onData: (id, data) => {
      getSender()?.send(TERM.data, { id, data })
      const det = detectors.get(id)
      if (det) {
        const hit = det.feed(data)
        if (hit) getSender()?.send(TERM.pr, { id, url: hit.url, term: hit.term })
      }
    },
    onExit: (id, exitCode) => {
      getSender()?.send(TERM.exit, { id, exitCode })
      detectors.delete(id)
    }
  })
```
In the `TERM.spawn` handler, after `manager.spawn(...)` succeeds, add:
```ts
      if (req.yolo) detectors.set(req.id, new PrDetector(buildForgePatterns(config)))
```
(The `expanded` prompt build already passes `req` to `buildInteractiveLaunch`; ensure the launch call passes `yolo` — it does, since `buildInteractiveLaunch(config, req, expanded)` and `req` carries `yolo`.)

- [ ] **Step 4: Extend `terminal-handlers.test.ts`** — add a yolo PR-detection test:

```ts
  it('emits pty:pr when a yolo session prints a PR url', async () => {
    const pty = fakePty()
    const send = vi.fn()
    const yoloCfg = { ...cfg, forges: { github: { prCommand: 'gh pr create', term: 'PR', urlPattern: 'https://github\\.com/[^/\\s]+/[^/\\s]+/pull/\\d+' } } } as unknown as Config
    registerTerminalIpc(yoloCfg, () => ({ send } as unknown as Electron.WebContents), () => pty as unknown as PtyProcess, deps)
    await handleMap.get('pty:spawn')!({}, { id: 'y', yolo: true, cols: 80, rows: 24 })
    pty.emitData('opened https://github.com/o/r/pull/5\n')
    expect(send).toHaveBeenCalledWith('pty:pr', { id: 'y', url: 'https://github.com/o/r/pull/5', term: 'PR' })
  })
```

- [ ] **Step 5: Run → PASS** — `pnpm test src/main/ipc/terminal-handlers.test.ts src/main/ipc/shell-handlers.test.ts`

- [ ] **Step 6: Preload** — in `src/preload/index.ts`, add `SHELL` to the shared-ipc import, add to `api`:
```ts
  openExternal: (url: string): Promise<{ ok: boolean }> => ipcRenderer.invoke(SHELL.openExternal, url),
  onTerminalPr: (cb: (e: import('../shared/ipc').TerminalPrEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: import('../shared/ipc').TerminalPrEvent): void => cb(payload)
    ipcRenderer.on(TERM.pr, listener)
    return () => ipcRenderer.off(TERM.pr, listener)
  },
```
(`spawnTerminal` already forwards the whole request, so `yolo` flows through with no change.)

- [ ] **Step 7: Main** — in `src/main/index.ts`, import and register shell ipc:
```ts
import { registerShellIpc } from './ipc/shell-handlers'
```
and in `app.whenReady()`, after `registerIpc(...)`:
```ts
  registerShellIpc()
```

- [ ] **Step 8: Typecheck + build** — clean.

- [ ] **Step 9: Commit**

```bash
git add src/main/ipc/terminal-handlers.ts src/main/ipc/terminal-handlers.test.ts src/main/ipc/shell-handlers.ts src/main/ipc/shell-handlers.test.ts src/preload/index.ts src/main/index.ts
git commit -m "feat(yolo): per-session PR detection + validated shell.openExternal"
```

---

### Task 4: Renderer — YOLO mode + PR-ready card (design task)

**Files:**
- Modify: `src/renderer/src/components/NewSessionMenu.vue`, `src/renderer/src/components/RightPanel.vue`, `src/renderer/src/components/TerminalView.vue`
- Test: `src/renderer/src/components/RightPanel.test.ts` (extend)

**Interfaces:**
- `NewSessionMenu` gains an Interactive|YOLO toggle; `start` payload gains `yolo: boolean`. In YOLO mode, "Interactive (no prompt)" is hidden (YOLO needs a prompt); the custom-prompt option remains.
- `RightPanel.Term` carries `yolo`; passes `:yolo` to `TerminalView`.
- `TerminalView` includes `yolo` in the spawn request and listens `onTerminalPr` → shows a PR-ready card; Open calls `window.api.openExternal(url)`.

- [ ] **Step 1: Update `NewSessionMenu.vue`** — add a mode toggle and put it in the `start` payload. In `<script setup>` add:
```ts
const mode = ref<'interactive' | 'yolo'>('interactive')
```
Change `choose` to include mode:
```ts
function choose(payload: { prompt?: { name?: string; text?: string } }): void {
  open.value = false
  customOpen.value = false
  const yolo = mode.value === 'yolo'
  customText.value = ''
  emit('start', { ...payload, yolo })
}
```
Update the emit type to `{ prompt?: { name?: string; text?: string }; yolo: boolean }`. In the template, add a toggle at the top of `.menu` and hide the no-prompt option in yolo mode:
```html
    <div v-if="open" class="menu">
      <div class="mode-toggle" role="group" aria-label="Session mode">
        <button type="button" :class="{ 'mode--on': mode === 'interactive' }" @click="mode = 'interactive'">Interactive</button>
        <button type="button" :class="{ 'mode--on': mode === 'yolo' }" @click="mode = 'yolo'">YOLO ⚡</button>
      </div>
      <button v-if="mode === 'interactive'" class="menu-item" @click="choose({})">Interactive (no prompt)</button>
      <button v-for="p in prompts" :key="p.name" class="menu-item" @click="choose({ prompt: { name: p.name } })">
        <span class="menu-item__name">{{ p.name }}</span>
        <span v-if="p.description" class="menu-item__desc">{{ p.description }}</span>
      </button>
      <button class="menu-item" @click="customOpen = !customOpen">Custom prompt…</button>
      <form v-if="customOpen" class="custom" @submit.prevent="choose({ prompt: { text: customText } })">
        <textarea v-model="customText" rows="3" placeholder="Type a first prompt…"></textarea>
        <button class="custom__go" type="submit" :disabled="!customText.trim()">Start</button>
      </form>
    </div>
```
Add styles (raccourier tokens; no bans):
```css
.mode-toggle { display: flex; gap: 2px; padding: 2px; margin-bottom: 4px; background: var(--surface); border-radius: var(--radius-sm); }
.mode-toggle button {
  flex: 1; background: transparent; color: var(--ink-muted); border: 0;
  border-radius: var(--radius-sm); padding: 5px 8px; cursor: pointer; font-weight: 600; font-size: 12px;
}
.mode-toggle button.mode--on { background: var(--surface-2); color: var(--ink); }
.mode-toggle button:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; }
```

- [ ] **Step 2: Update `RightPanel.vue`** — `Term` carries `yolo`; `startSession` reads it; pass to TerminalView. Change the interface + function:
```ts
interface Term { id: string; title: string; prompt?: { name?: string; text?: string }; yolo?: boolean }
```
```ts
function startSession(payload: { prompt?: { name?: string; text?: string }; yolo?: boolean }): void {
  counter += 1
  const id = `t${counter}-${Date.now()}`
  const base = payload.prompt?.name ?? (payload.yolo ? 'yolo' : 'Session')
  terms.value.push({ id, title: `${base} ${counter}`, prompt: payload.prompt, yolo: payload.yolo })
  activeId.value = id
}
```
In the template, pass `:yolo`:
```html
<TerminalView :id="t.id" :ticket-key="activeTicketKey" :prompt="t.prompt" :yolo="t.yolo" />
```

- [ ] **Step 3: Update `TerminalView.vue`** — add `yolo` prop, include it in spawn, add a PR-ready card. Change props:
```ts
const props = defineProps<{ id: string; ticketKey: string | null; prompt?: { name?: string; text?: string }; yolo?: boolean }>()
```
Add reactive state near the top of `<script setup>` (after imports):
```ts
import { ref } from 'vue'
const pr = ref<{ url: string; term: string } | null>(null)
let offPr: (() => void) | null = null
```
In `onMounted`, register the PR listener (alongside the data/exit listeners) and pass `yolo` in the spawn:
```ts
  offPr = window.api.onTerminalPr((e) => { if (e.id === props.id) pr.value = { url: e.url, term: e.term } })
```
and add `yolo: props.yolo,` to the `spawnTerminal({ … })` object. In `onBeforeUnmount`, add `offPr?.()`. Update the template:
```html
<template>
  <div class="terminal-wrap">
    <div v-if="pr" class="pr-card">
      <span class="pr-card__label">✅ {{ pr.term }} ready</span>
      <button class="pr-card__open" @click="openPr">Open</button>
    </div>
    <div ref="host" class="terminal-host"></div>
  </div>
</template>
```
Add `openPr`:
```ts
function openPr(): void {
  if (pr.value) window.api.openExternal(pr.value.url)
}
```
Styles:
```css
.terminal-wrap { display: flex; flex-direction: column; height: 100%; }
.terminal-host { flex: 1; width: 100%; min-height: 0; }
.pr-card {
  display: flex; align-items: center; gap: 10px; justify-content: space-between;
  padding: 8px 12px; background: color-mix(in oklch, var(--green) 14%, var(--surface));
  border: 1px solid color-mix(in oklch, var(--green) 40%, var(--hairline-strong));
  border-radius: var(--radius-sm); margin: 0 0 6px;
}
.pr-card__label { color: var(--ink); font-weight: 600; }
.pr-card__open {
  background: var(--teal); color: var(--bg); border: 0;
  border-radius: var(--radius-sm); padding: 5px 14px; cursor: pointer; font-weight: 600;
}
.pr-card__open:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
</style>
```
(Keep the existing `<style scoped>` open; append the new rules and remove the old `.terminal-host { width:100%; height:100% }` if duplicated.)

- [ ] **Step 4: Extend `RightPanel.test.ts`** — add `openExternal`/`onTerminalPr` to the `window.api` mock, and update the `NewSessionMenu` stub to emit `{ yolo: false }`. Change the api mock (beforeEach) to include:
```ts
    openExternal: vi.fn(async () => ({ ok: true })),
    onTerminalPr: vi.fn(() => () => {})
```
Update the default `NewSessionMenu` stub template to `@click="$emit('start', { yolo: false })"`, and the `TerminalView` stub props to include `yolo`. The existing tab-count tests still pass. Add:
```ts
  it('marks a yolo session title', async () => {
    const w = mount(RightPanel, { props: { activeTicketKey: null }, global: { stubs: {
      TerminalView: { props: ['id', 'ticketKey', 'prompt', 'yolo'], template: '<div class="tv" />' },
      NewSessionMenu: { template: '<button class="np" @click="$emit(\'start\', { prompt: { name: \'fix\' }, yolo: true })" />' }
    } } })
    await w.find('.np').trigger('click')
    expect(w.text()).toContain('fix')
  })
```

- [ ] **Step 5: Run → PASS** — `pnpm test src/renderer/src/components/RightPanel.test.ts`

- [ ] **Step 6: Full gate** — `pnpm test`, `pnpm typecheck`, `pnpm build`. Report vs baseline.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/NewSessionMenu.vue src/renderer/src/components/RightPanel.vue src/renderer/src/components/TerminalView.vue src/renderer/src/components/RightPanel.test.ts
git commit -m "feat(ui): YOLO mode toggle + PR-ready card with Open"
```

---

## Self-Review

**Spec coverage (Phase 4):** YOLO = visible auto-run terminal with bypass args + auto-prompt (Tasks 2,4) ✓; PR/MR detection on the stream across configured forges (Tasks 1,3) ✓; PR-ready card + Open (Task 4) ✓; opaque, heuristic, fire-once (Task 1) ✓. Deferred (spec, later): CLI launch args + packaging (Phase 5). The prompt-delivery + expansion reuse Phase 3 unchanged.

**Placeholder scan:** complete code in each step; commands have expected outcomes.

**Type consistency:** `PrDetector`/`buildForgePatterns`/`ForgePattern` (Task 1) used by the handler (Task 3). `SpawnTerminalRequest.yolo` (Task 2) set by TerminalView (Task 4), read by `buildInteractiveLaunch` (Task 2) + the handler's detector-arming (Task 3). `TERM.pr`/`TerminalPrEvent` (Task 2) emitted by the handler (Task 3), consumed by preload `onTerminalPr` (Task 3) + TerminalView (Task 4). `SHELL.openExternal` (Task 2) handled in shell-handlers (Task 3), exposed as `openExternal` (Task 3), called by TerminalView `openPr` (Task 4).

**Native isolation:** unchanged — `pr-detector.ts`/`shell-handlers.ts` import only `Config`/`electron`; no `node-pty`. Handler still injects `PtySpawner`.

**Security:** `shell:openExternal` rejects non-http(s); PR detection never executes anything — it only surfaces a URL the user clicks to open.
