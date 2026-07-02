# SeniorDev Phase 1 — Skeleton + Read Paths — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable Electron desktop app that connects to Jira Cloud, and lets you open ticket(s) by key into left-panel tabs rendered from native ADF. No terminal yet (Phase 2).

**Architecture:** Electron with a Node main process (privileged: config, Jira REST client, IPC) and a Vue 3 + Vite renderer (two-panel UI). The Jira API token lives only in main; the renderer talks to main over a narrow `contextBridge` IPC surface. ADF is rendered to sanitized HTML in the renderer by a self-contained walker.

**Tech Stack:** Electron, electron-vite, Vue 3 + TypeScript, Vite, Vitest + @vue/test-utils + jsdom, Zod, `yaml`, native `fetch`. Package manager: pnpm.

## Global Constraints

- **Package manager:** pnpm (never npm/yarn). Test command: `pnpm test` → `vitest run`. Typecheck: `pnpm typecheck`.
- **Branch discipline:** all Phase 1 work on branch `feat/phase1-skeleton` off `develop`. Never commit to `main`. Merge to `develop` with `--no-ff` when the phase is complete (orchestrator does this).
- **Commit messages:** no `Co-Authored-By: Claude` or any AI-attribution trailer.
- **Dependency floors (resolve to latest at install):** electron ^31, electron-vite ^2, @vitejs/plugin-vue ^5, vue ^3.4, typescript ^5.4, vitest ^2, @vue/test-utils ^2.4, jsdom ^24, zod ^3.23, yaml ^2.4.
- **Jira:** REST API v3, `GET /rest/api/3/issue/{key}`, Basic auth = base64(`email:apiToken`). Description/comments are ADF (Atlassian Document Format) JSON.
- **Security:** the renderer never receives the API token. ADF → HTML must escape all text and emit only a known tag allow-list (no raw HTML passthrough), so `v-html` is safe.
- **Palette (raccourier), copy verbatim into `tokens.css`:** warm charcoal theme; source hexes teal `#6cb49c`, amber `#e49c54`, tan `#b49c84`, charcoal `#545454`, cream `#fcfcfc`; design tokens in oklch as defined in Task 6. The deep impeccable design pass happens in a later phase — Phase 1 only establishes the tokens and a clean two-panel shell.

## File Structure (Phase 1)

```
seniordev-app/
  package.json                      # scripts + deps
  electron.vite.config.ts           # electron-vite (main/preload/renderer)
  tsconfig.json                     # references
  tsconfig.node.json                # main/preload
  tsconfig.web.json                 # renderer
  vitest.config.ts                  # jsdom, globals
  config.example.yaml               # sample config (jira-only minimal)
  src/
    shared/
      types.ts                      # AdfNode, Ticket, TicketComment
      ipc.ts                        # GetTicketResult discriminated union
    main/
      index.ts                      # app bootstrap, window, config load, ipc
      config/
        schema.ts                   # Zod Config schema + type
        presets.ts                  # built-in cliTools/forges presets
        load.ts                     # parse yaml + merge presets + validate
      jira/
        client.ts                   # JiraClient.fetchIssue(key) -> Ticket
        normalize.ts                # raw issue JSON -> Ticket
      ipc/
        handlers.ts                 # ipcMain.handle('jira:getTicket')
    preload/
      index.ts                      # contextBridge window.api
    renderer/
      index.html
      src/
        main.ts                     # Vue bootstrap
        App.vue                     # two-panel shell
        env.d.ts                    # window.api typing
        styles/
          tokens.css                # raccourier palette tokens
          base.css                  # resets + shell layout
        components/
          LeftPanel.vue             # key input + tabs + active ticket
          TicketView.vue            # ticket header + rendered ADF body
          RightPanelPlaceholder.vue # Phase 2 stub
        adf/
          renderToHtml.ts           # ADF -> sanitized HTML
  test/
    fixtures/
      issue-basic.json              # sample Jira issue response
```

---

### Task 1: Project scaffold + boot

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `vitest.config.ts`
- Create: `src/main/index.ts` (minimal), `src/preload/index.ts` (minimal), `src/renderer/index.html`, `src/renderer/src/main.ts`, `src/renderer/src/App.vue` (placeholder)
- Test: `test/smoke.test.ts`

**Interfaces:**
- Produces: working `pnpm dev`, `pnpm test`, `pnpm typecheck`; an empty window that loads the Vue renderer.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "seniordev-app",
  "version": "0.1.0-SNAPSHOT",
  "description": "SeniorDev — Jira ticket workbench + tabbed interactive CLI multiplexer",
  "main": "./out/main/index.js",
  "type": "module",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "typecheck": "vue-tsc --noEmit -p tsconfig.web.json && tsc --noEmit -p tsconfig.node.json",
    "test": "vitest run"
  },
  "dependencies": {
    "yaml": "^2.4.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.0.0",
    "@vue/test-utils": "^2.4.0",
    "electron": "^31.0.0",
    "electron-vite": "^2.0.0",
    "jsdom": "^24.0.0",
    "typescript": "^5.4.0",
    "vite": "^5.0.0",
    "vitest": "^2.0.0",
    "vue": "^3.4.0",
    "vue-tsc": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `electron.vite.config.ts`**

```ts
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: { '@': resolve('src/renderer/src') } },
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
    plugins: [vue()]
  }
})
```

- [ ] **Step 3: Create the three tsconfig files**

`tsconfig.json`:
```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }]
}
```
`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "target": "ES2022",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/main/**/*", "src/preload/**/*", "src/shared/**/*", "electron.vite.config.ts"]
}
```
`tsconfig.web.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "target": "ES2022",
    "strict": true,
    "jsx": "preserve",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/renderer/src/*"] }
  },
  "include": ["src/renderer/src/**/*", "src/shared/**/*"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: { environment: 'jsdom', globals: true, include: ['src/**/*.test.ts', 'test/**/*.test.ts'] }
})
```

- [ ] **Step 5: Create minimal main/preload/renderer entry files**

`src/main/index.ts`:
```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  win.on('ready-to-show', () => win.show())
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```
`src/preload/index.ts`:
```ts
// Populated in Task 5.
export {}
```
`src/renderer/index.html`:
```html
<!doctype html>
<html>
  <head><meta charset="UTF-8" /><title>SeniorDev</title></head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```
`src/renderer/src/main.ts`:
```ts
import { createApp } from 'vue'
import App from './App.vue'

createApp(App).mount('#app')
```
`src/renderer/src/App.vue`:
```vue
<template>
  <div class="shell">SeniorDev — scaffold OK</div>
</template>
```

- [ ] **Step 6: Write the smoke test** — `test/smoke.test.ts`

```ts
import { describe, it, expect } from 'vitest'

describe('smoke', () => {
  it('runs the test harness', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 7: Install and verify**

Run: `pnpm install`
Run: `pnpm test`
Expected: 1 passing test.
Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 8: Manual boot check**

Run: `pnpm dev`
Expected: a window opens showing "SeniorDev — scaffold OK". Close it.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold electron-vite + vue + vitest app shell"
```

---

### Task 2: Config schema, presets, and loader

**Files:**
- Create: `src/main/config/schema.ts`, `src/main/config/presets.ts`, `src/main/config/load.ts`, `config.example.yaml`
- Test: `src/main/config/load.test.ts`

**Interfaces:**
- Produces: `loadConfig(path: string): Config`; `Config` type; `ConfigSchema`. `Config.jira = { baseUrl, email, apiToken }`. Built-in presets guarantee `cliTools.claude/codex` and `forges.github/gitlab` exist even for a jira-only config.

- [ ] **Step 1: Write the Zod schema** — `src/main/config/schema.ts`

```ts
import { z } from 'zod'

export const CliToolSchema = z.object({
  command: z.string().min(1),
  interactiveArgs: z.array(z.string()).default([]),
  yoloArgs: z.array(z.string()).default([]),
  promptDelivery: z.enum(['stdin', 'arg']).default('stdin'),
  promptArg: z.string().optional()
})

export const ForgeSchema = z.object({
  prCommand: z.string().default(''),
  term: z.string().default('PR'),
  urlPattern: z.string().min(1)
})

export const RepoSchema = z.object({
  key: z.string().min(1),
  path: z.string().min(1),
  branchPrefix: z.string().default(''),
  forge: z.string().optional()
})

export const JiraSchema = z.object({
  baseUrl: z.string().url(),
  email: z.string().email(),
  apiToken: z.string().min(1)
})

export const ConfigSchema = z.object({
  jira: JiraSchema,
  ticketContext: z.enum(['inject', 'key-only', 'both']).default('both'),
  defaultTool: z.string().default('claude'),
  cliTools: z.record(CliToolSchema).default({}),
  defaultForge: z.string().default('github'),
  forges: z.record(ForgeSchema).default({}),
  repos: z.array(RepoSchema).default([]),
  promptsDir: z.string().optional()
})

export type Config = z.infer<typeof ConfigSchema>
```

- [ ] **Step 2: Write the presets** — `src/main/config/presets.ts`

```ts
export const CLI_PRESETS = {
  claude: {
    command: 'claude',
    interactiveArgs: [],
    yoloArgs: ['--permission-mode', 'bypassPermissions'],
    promptDelivery: 'stdin'
  },
  codex: {
    command: 'codex',
    interactiveArgs: [],
    yoloArgs: ['--yolo'],
    promptDelivery: 'arg',
    promptArg: '{{prompt}}'
  }
} as const

export const FORGE_PRESETS = {
  github: {
    prCommand: 'gh pr create',
    term: 'PR',
    urlPattern: 'https://github\\.com/[^/]+/[^/]+/pull/\\d+'
  },
  gitlab: {
    prCommand: 'glab mr create',
    term: 'MR',
    urlPattern: 'https://gitlab\\.com/.+/-/merge_requests/\\d+'
  }
} as const
```

- [ ] **Step 3: Write the failing loader test** — `src/main/config/load.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadConfig } from './load'

function tmpConfig(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'sd-cfg-'))
  const p = join(dir, 'config.yaml')
  writeFileSync(p, yaml, 'utf8')
  return p
}

const MINIMAL = `
jira:
  baseUrl: https://acme.atlassian.net
  email: dev@acme.com
  apiToken: secret-token
`

describe('loadConfig', () => {
  it('loads a minimal jira-only config and applies presets + defaults', () => {
    const cfg = loadConfig(tmpConfig(MINIMAL))
    expect(cfg.jira.baseUrl).toBe('https://acme.atlassian.net')
    expect(cfg.ticketContext).toBe('both')
    expect(cfg.defaultTool).toBe('claude')
    expect(cfg.cliTools.claude.command).toBe('claude')
    expect(cfg.cliTools.codex.promptDelivery).toBe('arg')
    expect(cfg.forges.github.term).toBe('PR')
    expect(cfg.forges.gitlab.prCommand).toBe('glab mr create')
  })

  it('lets a user entry override a preset by key', () => {
    const cfg = loadConfig(
      tmpConfig(MINIMAL + '\ncliTools:\n  claude:\n    command: my-claude\n')
    )
    expect(cfg.cliTools.claude.command).toBe('my-claude')
    expect(cfg.cliTools.codex.command).toBe('codex')
  })

  it('throws on invalid jira email', () => {
    expect(() =>
      loadConfig(tmpConfig(`
jira:
  baseUrl: https://acme.atlassian.net
  email: not-an-email
  apiToken: x
`))
    ).toThrow()
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm test src/main/config/load.test.ts`
Expected: FAIL — `loadConfig` not found / module missing.

- [ ] **Step 5: Write the loader** — `src/main/config/load.ts`

```ts
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { ConfigSchema, type Config } from './schema'
import { CLI_PRESETS, FORGE_PRESETS } from './presets'

export function loadConfig(path: string): Config {
  const raw = (parse(readFileSync(path, 'utf8')) ?? {}) as Record<string, unknown>
  raw.cliTools = { ...CLI_PRESETS, ...((raw.cliTools as object) ?? {}) }
  raw.forges = { ...FORGE_PRESETS, ...((raw.forges as object) ?? {}) }
  return ConfigSchema.parse(raw)
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test src/main/config/load.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Write `config.example.yaml`**

```yaml
# Copy to your OS config dir (e.g. %APPDATA%/SeniorDev/config.yaml) and fill in.
jira:
  baseUrl: https://yoursite.atlassian.net
  email: you@company.com
  apiToken: paste-token-from-id.atlassian.net

# Everything below is optional; presets for claude/codex + github/gitlab apply automatically.
# ticketContext: both        # inject | key-only | both
# defaultTool: claude
# defaultForge: github
# repos:
#   - key: PROJ
#     path: C:/Users/you/code/backend
#     branchPrefix: feature/
#     forge: github
```

- [ ] **Step 8: Commit**

```bash
git add src/main/config config.example.yaml
git commit -m "feat(config): zod-validated yaml loader with cli/forge presets"
```

---

### Task 3: Shared types + Jira client and normalizer

**Files:**
- Create: `src/shared/types.ts`, `src/main/jira/normalize.ts`, `src/main/jira/client.ts`, `test/fixtures/issue-basic.json`
- Test: `src/main/jira/normalize.test.ts`, `src/main/jira/client.test.ts`

**Interfaces:**
- Produces:
  - `AdfNode { type: string; content?: AdfNode[]; text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[]; attrs?: Record<string, unknown> }`
  - `TicketComment { author: string; createdIso: string; bodyAdf: AdfNode | null }`
  - `Ticket { key: string; type: string; status: string; summary: string; descriptionAdf: AdfNode | null; acceptanceCriteria: string | null; comments: TicketComment[]; url: string }`
  - `normalizeIssue(raw, baseUrl): Ticket`
  - `class JiraClient { constructor(cfg: { baseUrl; email; apiToken }, fetchFn?: typeof fetch); fetchIssue(key: string): Promise<Ticket> }`

- [ ] **Step 1: Write shared types** — `src/shared/types.ts`

```ts
export interface AdfNode {
  type: string
  content?: AdfNode[]
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  attrs?: Record<string, unknown>
}

export interface TicketComment {
  author: string
  createdIso: string
  bodyAdf: AdfNode | null
}

export interface Ticket {
  key: string
  type: string
  status: string
  summary: string
  descriptionAdf: AdfNode | null
  acceptanceCriteria: string | null
  comments: TicketComment[]
  url: string
}
```

- [ ] **Step 2: Create the fixture** — `test/fixtures/issue-basic.json`

```json
{
  "key": "PROJ-123",
  "fields": {
    "summary": "Login button dead on iOS",
    "status": { "name": "In Progress" },
    "issuetype": { "name": "Bug" },
    "description": {
      "type": "doc",
      "version": 1,
      "content": [
        { "type": "paragraph", "content": [{ "type": "text", "text": "Tapping login does nothing." }] }
      ]
    },
    "comment": {
      "comments": [
        {
          "author": { "displayName": "Jane Dev" },
          "created": "2026-06-30T12:00:00.000+0000",
          "body": { "type": "doc", "version": 1, "content": [] }
        }
      ]
    }
  }
}
```

- [ ] **Step 3: Write the failing normalizer test** — `src/main/jira/normalize.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeIssue } from './normalize'

const raw = JSON.parse(
  readFileSync(join(__dirname, '../../../test/fixtures/issue-basic.json'), 'utf8')
)

describe('normalizeIssue', () => {
  it('maps standard fields into a Ticket', () => {
    const t = normalizeIssue(raw, 'https://acme.atlassian.net/')
    expect(t.key).toBe('PROJ-123')
    expect(t.type).toBe('Bug')
    expect(t.status).toBe('In Progress')
    expect(t.summary).toBe('Login button dead on iOS')
    expect(t.descriptionAdf?.type).toBe('doc')
    expect(t.comments).toHaveLength(1)
    expect(t.comments[0].author).toBe('Jane Dev')
    expect(t.url).toBe('https://acme.atlassian.net/browse/PROJ-123')
  })

  it('defaults missing fields safely', () => {
    const t = normalizeIssue({ key: 'X-1', fields: {} }, 'https://acme.atlassian.net')
    expect(t.type).toBe('')
    expect(t.status).toBe('')
    expect(t.descriptionAdf).toBeNull()
    expect(t.comments).toEqual([])
  })
})
```

- [ ] **Step 4: Run to verify it fails**

Run: `pnpm test src/main/jira/normalize.test.ts`
Expected: FAIL — `normalizeIssue` not found.

- [ ] **Step 5: Write the normalizer** — `src/main/jira/normalize.ts`

```ts
import type { Ticket, TicketComment, AdfNode } from '../../shared/types'

interface RawComment {
  author?: { displayName?: string }
  created?: string
  body?: AdfNode | null
}
interface RawIssue {
  key: string
  fields?: {
    summary?: string
    status?: { name?: string }
    issuetype?: { name?: string }
    description?: AdfNode | null
    comment?: { comments?: RawComment[] }
  }
}

export function normalizeIssue(raw: RawIssue, baseUrl: string): Ticket {
  const f = raw.fields ?? {}
  const comments: TicketComment[] = (f.comment?.comments ?? []).map((c) => ({
    author: c.author?.displayName ?? 'Unknown',
    createdIso: c.created ?? '',
    bodyAdf: c.body ?? null
  }))
  const base = baseUrl.replace(/\/$/, '')
  return {
    key: raw.key,
    type: f.issuetype?.name ?? '',
    status: f.status?.name ?? '',
    summary: f.summary ?? '',
    descriptionAdf: f.description ?? null,
    acceptanceCriteria: null,
    comments,
    url: `${base}/browse/${raw.key}`
  }
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm test src/main/jira/normalize.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Write the failing client test** — `src/main/jira/client.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JiraClient } from './client'

const fixture = JSON.parse(
  readFileSync(join(__dirname, '../../../test/fixtures/issue-basic.json'), 'utf8')
)
const cfg = { baseUrl: 'https://acme.atlassian.net', email: 'dev@acme.com', apiToken: 'tok' }

describe('JiraClient.fetchIssue', () => {
  it('calls the v3 issue endpoint with basic auth and returns a Ticket', async () => {
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toContain('/rest/api/3/issue/PROJ-123')
      expect((init.headers as Record<string, string>).Authorization).toBe(
        'Basic ' + Buffer.from('dev@acme.com:tok').toString('base64')
      )
      return { ok: true, status: 200, json: async () => fixture } as Response
    })
    const client = new JiraClient(cfg, fetchFn as unknown as typeof fetch)
    const t = await client.fetchIssue('PROJ-123')
    expect(t.summary).toBe('Login button dead on iOS')
  })

  it('throws on a non-ok response', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 404, statusText: 'Not Found' } as Response))
    const client = new JiraClient(cfg, fetchFn as unknown as typeof fetch)
    await expect(client.fetchIssue('NOPE-1')).rejects.toThrow(/404/)
  })
})
```

- [ ] **Step 8: Run to verify it fails**

Run: `pnpm test src/main/jira/client.test.ts`
Expected: FAIL — `JiraClient` not found.

- [ ] **Step 9: Write the client** — `src/main/jira/client.ts`

```ts
import type { Ticket } from '../../shared/types'
import { normalizeIssue } from './normalize'

export interface JiraConfig {
  baseUrl: string
  email: string
  apiToken: string
}

const FIELDS = 'summary,status,issuetype,description,comment'

export class JiraClient {
  constructor(
    private readonly cfg: JiraConfig,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  private authHeader(): string {
    const token = Buffer.from(`${this.cfg.email}:${this.cfg.apiToken}`).toString('base64')
    return `Basic ${token}`
  }

  async fetchIssue(key: string): Promise<Ticket> {
    const base = this.cfg.baseUrl.replace(/\/$/, '')
    const url = `${base}/rest/api/3/issue/${encodeURIComponent(key)}?fields=${FIELDS}`
    const res = await this.fetchFn(url, {
      headers: { Authorization: this.authHeader(), Accept: 'application/json' }
    })
    if (!res.ok) {
      throw new Error(`Jira request failed (${res.status} ${res.statusText || ''}) for ${key}`)
    }
    const raw = await res.json()
    return normalizeIssue(raw, base)
  }
}
```

- [ ] **Step 10: Run to verify it passes**

Run: `pnpm test src/main/jira`
Expected: PASS (4 tests total across normalize + client).

- [ ] **Step 11: Commit**

```bash
git add src/shared/types.ts src/main/jira test/fixtures/issue-basic.json
git commit -m "feat(jira): v3 issue client + ADF-aware ticket normalizer"
```

---

### Task 4: ADF → sanitized HTML renderer

**Files:**
- Create: `src/renderer/src/adf/renderToHtml.ts`
- Test: `src/renderer/src/adf/renderToHtml.test.ts`

**Interfaces:**
- Consumes: `AdfNode` from `src/shared/types.ts`.
- Produces: `renderAdfToHtml(doc: AdfNode | null): string` — escapes all text, emits only a known tag allow-list, so the result is safe for `v-html`.

- [ ] **Step 1: Write the failing test** — `src/renderer/src/adf/renderToHtml.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { renderAdfToHtml } from './renderToHtml'
import type { AdfNode } from '../../../shared/types'

const doc = (content: AdfNode[]): AdfNode => ({ type: 'doc', content })

describe('renderAdfToHtml', () => {
  it('returns empty string for null', () => {
    expect(renderAdfToHtml(null)).toBe('')
  })

  it('renders a paragraph with strong and link marks', () => {
    const html = renderAdfToHtml(
      doc([
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'hi ' },
            { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
            { type: 'text', text: ' link', marks: [{ type: 'link', attrs: { href: 'https://x.io' } }] }
          ]
        }
      ])
    )
    expect(html).toContain('<p>hi <strong>bold</strong>')
    expect(html).toContain('<a href="https://x.io" target="_blank" rel="noreferrer noopener"> link</a>')
  })

  it('escapes HTML in text and code blocks', () => {
    const html = renderAdfToHtml(
      doc([
        { type: 'codeBlock', content: [{ type: 'text', text: '<script>alert(1)</script>' }] }
      ])
    )
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('renders headings, lists, and panels', () => {
    const html = renderAdfToHtml(
      doc([
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'bulletList', content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] }
        ] },
        { type: 'panel', attrs: { panelType: 'warning' }, content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'careful' }] }
        ] }
      ])
    )
    expect(html).toContain('<h2>Title</h2>')
    expect(html).toContain('<ul><li><p>a</p></li></ul>')
    expect(html).toContain('adf-panel--warning')
  })

  it('falls back to rendering children for unknown node types', () => {
    const html = renderAdfToHtml(
      doc([{ type: 'someFutureNode', content: [{ type: 'text', text: 'still shown' }] }])
    )
    expect(html).toContain('still shown')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/renderer/src/adf/renderToHtml.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the renderer** — `src/renderer/src/adf/renderToHtml.ts`

```ts
import type { AdfNode } from '../../../shared/types'

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderMarks(text: string, marks: AdfNode['marks']): string {
  let html = esc(text)
  for (const m of marks ?? []) {
    switch (m.type) {
      case 'strong': html = `<strong>${html}</strong>`; break
      case 'em': html = `<em>${html}</em>`; break
      case 'code': html = `<code>${html}</code>`; break
      case 'strike': html = `<s>${html}</s>`; break
      case 'underline': html = `<u>${html}</u>`; break
      case 'link': {
        const href = esc(String(m.attrs?.href ?? '#'))
        html = `<a href="${href}" target="_blank" rel="noreferrer noopener">${html}</a>`
        break
      }
    }
  }
  return html
}

function renderNodes(nodes: AdfNode[] | undefined): string {
  return (nodes ?? []).map(renderNode).join('')
}

function renderNode(node: AdfNode): string {
  switch (node.type) {
    case 'doc': return renderNodes(node.content)
    case 'paragraph': return `<p>${renderNodes(node.content)}</p>`
    case 'text': return renderMarks(node.text ?? '', node.marks)
    case 'hardBreak': return '<br>'
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6)
      return `<h${level}>${renderNodes(node.content)}</h${level}>`
    }
    case 'bulletList': return `<ul>${renderNodes(node.content)}</ul>`
    case 'orderedList': return `<ol>${renderNodes(node.content)}</ol>`
    case 'listItem': return `<li>${renderNodes(node.content)}</li>`
    case 'blockquote': return `<blockquote>${renderNodes(node.content)}</blockquote>`
    case 'rule': return '<hr>'
    case 'codeBlock': return `<pre><code>${renderNodes(node.content)}</code></pre>`
    case 'panel': {
      const type = esc(String(node.attrs?.panelType ?? 'info'))
      return `<div class="adf-panel adf-panel--${type}">${renderNodes(node.content)}</div>`
    }
    case 'table': return `<table>${renderNodes(node.content)}</table>`
    case 'tableRow': return `<tr>${renderNodes(node.content)}</tr>`
    case 'tableHeader': return `<th>${renderNodes(node.content)}</th>`
    case 'tableCell': return `<td>${renderNodes(node.content)}</td>`
    case 'mention':
      return `<span class="adf-mention">@${esc(String(node.attrs?.text ?? node.attrs?.id ?? ''))}</span>`
    case 'emoji':
      return esc(String(node.attrs?.text ?? node.attrs?.shortName ?? ''))
    case 'inlineCard': {
      const url = esc(String(node.attrs?.url ?? '#'))
      return `<a href="${url}" target="_blank" rel="noreferrer noopener">${url}</a>`
    }
    case 'mediaSingle':
    case 'mediaGroup':
    case 'media':
      return `<div class="adf-media">[media]</div>`
    default:
      return renderNodes(node.content)
  }
}

export function renderAdfToHtml(doc: AdfNode | null): string {
  if (!doc) return ''
  return renderNode(doc)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/renderer/src/adf/renderToHtml.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/adf
git commit -m "feat(adf): sanitized ADF-to-HTML renderer"
```

---

### Task 5: IPC surface (main handler + preload bridge)

**Files:**
- Create: `src/shared/ipc.ts`, `src/main/ipc/handlers.ts`
- Modify: `src/preload/index.ts`, `src/main/index.ts`
- Create: `src/renderer/src/env.d.ts`
- Test: `src/main/ipc/handlers.test.ts`

**Interfaces:**
- Produces:
  - `type GetTicketResult = { ok: true; ticket: Ticket } | { ok: false; error: string }`
  - `registerIpc(getTicket: (key: string) => Promise<Ticket>): void` — registers `ipcMain.handle('jira:getTicket')`.
  - Renderer global `window.api.getTicket(key: string): Promise<GetTicketResult>`.
- Note: `registerIpc` takes a function (not the whole client) so it's unit-testable without Electron internals and so the "no config" path can inject a rejecting function.

- [ ] **Step 1: Write the IPC result type** — `src/shared/ipc.ts`

```ts
import type { Ticket } from './types'

export type GetTicketResult = { ok: true; ticket: Ticket } | { ok: false; error: string }

export const IPC = { getTicket: 'jira:getTicket' } as const
```

- [ ] **Step 2: Write the failing handler test** — `src/main/ipc/handlers.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers = new Map<string, (...a: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => handlers.set(ch, fn) }
}))

import { registerIpc } from './handlers'
import type { Ticket } from '../../shared/types'

const ticket: Ticket = {
  key: 'PROJ-1', type: 'Bug', status: 'Open', summary: 's',
  descriptionAdf: null, acceptanceCriteria: null, comments: [], url: 'u'
}

beforeEach(() => handlers.clear())

describe('registerIpc', () => {
  it('returns { ok: true, ticket } on success', async () => {
    registerIpc(async () => ticket)
    const res = await handlers.get('jira:getTicket')!({}, 'PROJ-1')
    expect(res).toEqual({ ok: true, ticket })
  })

  it('returns { ok: false, error } when the fetch throws', async () => {
    registerIpc(async () => { throw new Error('boom') })
    const res = await handlers.get('jira:getTicket')!({}, 'PROJ-1')
    expect(res).toEqual({ ok: false, error: 'boom' })
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm test src/main/ipc/handlers.test.ts`
Expected: FAIL — `registerIpc` not found.

- [ ] **Step 4: Write the handler** — `src/main/ipc/handlers.ts`

```ts
import { ipcMain } from 'electron'
import type { Ticket } from '../../shared/types'
import { IPC, type GetTicketResult } from '../../shared/ipc'

export function registerIpc(getTicket: (key: string) => Promise<Ticket>): void {
  ipcMain.handle(IPC.getTicket, async (_e, key: string): Promise<GetTicketResult> => {
    try {
      const ticket = await getTicket(key)
      return { ok: true, ticket }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test src/main/ipc/handlers.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Write the preload bridge** — `src/preload/index.ts`

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type GetTicketResult } from '../shared/ipc'

const api = {
  getTicket: (key: string): Promise<GetTicketResult> => ipcRenderer.invoke(IPC.getTicket, key)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
```

- [ ] **Step 7: Add renderer typing** — `src/renderer/src/env.d.ts`

```ts
/// <reference types="vite/client" />
import type { Api } from '../../preload/index'

declare global {
  interface Window {
    api: Api
  }
}

export {}
```

- [ ] **Step 8: Wire main to load config + register IPC** — replace `src/main/index.ts`

```ts
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
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
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
```

- [ ] **Step 9: Typecheck + commit**

Run: `pnpm typecheck`
Expected: no errors.
```bash
git add src/shared/ipc.ts src/main/ipc src/preload/index.ts src/main/index.ts src/renderer/src/env.d.ts
git commit -m "feat(ipc): jira:getTicket bridge with result type + config-backed main"
```

---

### Task 6: Design tokens + two-panel shell

**Files:**
- Create: `src/renderer/src/styles/tokens.css`, `src/renderer/src/styles/base.css`, `src/renderer/src/components/RightPanelPlaceholder.vue`
- Modify: `src/renderer/src/App.vue`, `src/renderer/src/main.ts`

**Interfaces:**
- Produces: an `App.vue` shell with `.left-panel` and `.right-panel` regions; global CSS custom properties (raccourier palette) available app-wide.

- [ ] **Step 1: Write the palette tokens** — `src/renderer/src/styles/tokens.css`

```css
/* SeniorDev palette — raccourier scheme (warm charcoal + teal/amber/tan accents).
   Source hexes: teal #6cb49c, amber #e49c54, tan #b49c84, charcoal #545454, cream #fcfcfc. */
:root {
  --bg:        oklch(0.21 0.012 165);
  --surface:   oklch(0.255 0.014 165);
  --surface-2: oklch(0.305 0.016 165);
  --hairline:  oklch(1 0 0 / 0.08);
  --hairline-strong: oklch(1 0 0 / 0.14);

  --ink:       oklch(0.95 0.008 95);
  --ink-soft:  oklch(0.82 0.012 120);
  --ink-muted: oklch(0.70 0.014 140);

  --teal:  oklch(0.78 0.085 168);
  --green: oklch(0.79 0.11 155);
  --amber: oklch(0.80 0.115 68);
  --tan:   oklch(0.77 0.045 78);
  --rust:  oklch(0.68 0.15 38);

  --radius: 12px;
  --radius-sm: 8px;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

- [ ] **Step 2: Write base + shell layout** — `src/renderer/src/styles/base.css`

```css
* { box-sizing: border-box; }
html, body, #app { height: 100%; margin: 0; }
body {
  background: var(--bg);
  color: var(--ink);
  font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
.shell { display: flex; height: 100%; }
.left-panel, .right-panel { height: 100%; overflow: hidden; display: flex; flex-direction: column; }
.left-panel { flex: 1 1 50%; border-right: 1px solid var(--hairline); }
.right-panel { flex: 1 1 50%; background: var(--surface); }
.panel-empty { margin: auto; color: var(--ink-muted); }
```

- [ ] **Step 3: Write the right-panel placeholder** — `src/renderer/src/components/RightPanelPlaceholder.vue`

```vue
<template>
  <div class="right-panel">
    <div class="panel-empty">Terminals arrive in Phase 2</div>
  </div>
</template>
```

- [ ] **Step 4: Rewrite `App.vue` as the shell**

```vue
<script setup lang="ts">
import LeftPanel from './components/LeftPanel.vue'
import RightPanelPlaceholder from './components/RightPanelPlaceholder.vue'
</script>

<template>
  <div class="shell">
    <LeftPanel />
    <RightPanelPlaceholder />
  </div>
</template>
```

- [ ] **Step 5: Import styles in `main.ts`** — replace `src/renderer/src/main.ts`

```ts
import { createApp } from 'vue'
import App from './App.vue'
import './styles/tokens.css'
import './styles/base.css'

createApp(App).mount('#app')
```

- [ ] **Step 6: Note**

`LeftPanel.vue` is created in Task 7. Do not run `pnpm dev` until Task 7 Step 4; typecheck will fail until then because `App.vue` imports it. Proceed to Task 7 before verifying the shell visually.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/styles src/renderer/src/components/RightPanelPlaceholder.vue src/renderer/src/App.vue src/renderer/src/main.ts
git commit -m "feat(ui): raccourier design tokens + two-panel shell"
```

---

### Task 7: Left panel — open ticket by key into tabs

**Files:**
- Create: `src/renderer/src/components/LeftPanel.vue`, `src/renderer/src/components/TicketView.vue`
- Test: `src/renderer/src/components/LeftPanel.test.ts`

**Interfaces:**
- Consumes: `window.api.getTicket` (`GetTicketResult`), `renderAdfToHtml`, `Ticket`.
- Produces: the end-to-end read path — type a key, press Open (or Enter), see the rendered ticket in a tab; errors show inline; duplicate keys re-activate the existing tab.

- [ ] **Step 1: Write `TicketView.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import type { Ticket } from '../../../shared/types'
import { renderAdfToHtml } from '../adf/renderToHtml'

const props = defineProps<{ ticket: Ticket }>()
const bodyHtml = computed(() => renderAdfToHtml(props.ticket.descriptionAdf))
</script>

<template>
  <article class="ticket">
    <header class="ticket__head">
      <a class="ticket__key" :href="ticket.url" target="_blank" rel="noreferrer noopener">{{ ticket.key }}</a>
      <span class="ticket__type">{{ ticket.type }}</span>
      <span class="ticket__status">{{ ticket.status }}</span>
    </header>
    <h1 class="ticket__summary">{{ ticket.summary }}</h1>
    <!-- Safe: renderAdfToHtml escapes all text and emits only known tags. -->
    <div class="ticket__body" v-html="bodyHtml"></div>
  </article>
</template>

<style scoped>
.ticket { padding: 16px 20px; overflow: auto; }
.ticket__head { display: flex; gap: 10px; align-items: center; color: var(--ink-muted); font-size: 12px; }
.ticket__key { color: var(--teal); text-decoration: none; font-weight: 600; }
.ticket__status { color: var(--amber); }
.ticket__summary { font-size: 18px; margin: 8px 0 12px; color: var(--ink); }
.ticket__body :is(h1,h2,h3) { color: var(--ink); }
.ticket__body a { color: var(--teal); }
.ticket__body code { background: var(--surface-2); padding: 0 4px; border-radius: var(--radius-sm); }
.ticket__body pre { background: var(--surface-2); padding: 10px; border-radius: var(--radius-sm); overflow: auto; }
.adf-panel { border-left: 3px solid var(--teal); background: var(--surface); padding: 8px 12px; border-radius: var(--radius-sm); margin: 8px 0; }
.adf-panel--warning { border-left-color: var(--amber); }
.adf-panel--error { border-left-color: var(--rust); }
</style>
```

- [ ] **Step 2: Write the failing LeftPanel test** — `src/renderer/src/components/LeftPanel.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import LeftPanel from './LeftPanel.vue'
import type { Ticket } from '../../../shared/types'

function ticket(key: string): Ticket {
  return {
    key, type: 'Bug', status: 'Open', summary: `Summary ${key}`,
    descriptionAdf: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'body' }] }] },
    acceptanceCriteria: null, comments: [], url: `https://x/browse/${key}`
  }
}

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    getTicket: vi.fn(async (key: string) =>
      key === 'BAD-1' ? { ok: false, error: 'Jira 404' } : { ok: true, ticket: ticket(key) }
    )
  }
})

async function open(wrapper: ReturnType<typeof mount>, key: string) {
  await wrapper.find('input').setValue(key)
  await wrapper.find('button').trigger('click')
  await flushPromises()
}

describe('LeftPanel', () => {
  it('opens a ticket into a tab and renders it', async () => {
    const w = mount(LeftPanel)
    await open(w, 'PROJ-1')
    expect(w.text()).toContain('Summary PROJ-1')
    expect(w.text()).toContain('body')
  })

  it('shows an inline error when the fetch fails', async () => {
    const w = mount(LeftPanel)
    await open(w, 'BAD-1')
    expect(w.text()).toContain('Jira 404')
  })

  it('re-activates an existing tab instead of duplicating', async () => {
    const w = mount(LeftPanel)
    await open(w, 'PROJ-1')
    await open(w, 'PROJ-1')
    expect(w.findAll('.tab')).toHaveLength(1)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm test src/renderer/src/components/LeftPanel.test.ts`
Expected: FAIL — `LeftPanel.vue` not found.

- [ ] **Step 4: Write `LeftPanel.vue`**

```vue
<script setup lang="ts">
import { ref } from 'vue'
import type { Ticket } from '../../../shared/types'
import TicketView from './TicketView.vue'

const keyInput = ref('')
const tabs = ref<Ticket[]>([])
const activeKey = ref<string | null>(null)
const error = ref<string | null>(null)

async function openTicket(): Promise<void> {
  const key = keyInput.value.trim().toUpperCase()
  error.value = null
  if (!key) return
  const existing = tabs.value.find((t) => t.key === key)
  if (existing) {
    activeKey.value = existing.key
    keyInput.value = ''
    return
  }
  const res = await window.api.getTicket(key)
  if (res.ok) {
    tabs.value.push(res.ticket)
    activeKey.value = res.ticket.key
    keyInput.value = ''
  } else {
    error.value = res.error
  }
}

function closeTab(key: string): void {
  const i = tabs.value.findIndex((t) => t.key === key)
  if (i === -1) return
  tabs.value.splice(i, 1)
  if (activeKey.value === key) activeKey.value = tabs.value.at(-1)?.key ?? null
}

function activeTicket(): Ticket | undefined {
  return tabs.value.find((t) => t.key === activeKey.value)
}
</script>

<template>
  <section class="left-panel">
    <div class="opener">
      <input
        v-model="keyInput"
        placeholder="Ticket key (e.g. PROJ-123)"
        @keyup.enter="openTicket"
      />
      <button @click="openTicket">Open</button>
    </div>
    <p v-if="error" class="opener__error">{{ error }}</p>

    <nav class="tabs">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="tab"
        :class="{ 'tab--active': t.key === activeKey }"
        @click="activeKey = t.key"
      >
        {{ t.key }}
        <span class="tab__close" @click.stop="closeTab(t.key)">×</span>
      </button>
    </nav>

    <div class="left-body">
      <TicketView v-if="activeTicket()" :ticket="activeTicket()!" />
      <div v-else class="panel-empty">Open a ticket to start</div>
    </div>
  </section>
</template>

<style scoped>
.opener { display: flex; gap: 8px; padding: 10px; border-bottom: 1px solid var(--hairline); }
.opener input {
  flex: 1; background: var(--surface); color: var(--ink);
  border: 1px solid var(--hairline-strong); border-radius: var(--radius-sm); padding: 6px 10px;
}
.opener button {
  background: var(--teal); color: var(--bg); border: 0;
  border-radius: var(--radius-sm); padding: 6px 14px; cursor: pointer; font-weight: 600;
}
.opener__error { color: var(--rust); margin: 6px 10px 0; font-size: 13px; }
.tabs { display: flex; gap: 4px; padding: 8px 10px 0; flex-wrap: wrap; }
.tab {
  background: var(--surface); color: var(--ink-soft);
  border: 1px solid var(--hairline); border-bottom: 0;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0; padding: 5px 10px; cursor: pointer;
}
.tab--active { background: var(--surface-2); color: var(--ink); }
.tab__close { margin-left: 6px; color: var(--ink-muted); }
.left-body { flex: 1; overflow: auto; }
</style>
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test src/renderer/src/components/LeftPanel.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Full gate**

Run: `pnpm test`
Expected: all tests pass (config 3, normalize 2, client 2, adf 5, ipc 2, leftpanel 3, smoke 1).
Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Manual end-to-end check**

Create a real config at the path from `resolveConfigPath()` (Windows: `%APPDATA%/SeniorDev/config.yaml`, or set `SENIORDEV_CONFIG` to a file path) using `config.example.yaml` with real Jira credentials.
Run: `pnpm dev`
Expected: type a real ticket key, press Enter/Open → the ticket renders in a tab. Type a bad key → inline error. This is the user's verification (real Jira creds can't be mocked).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/LeftPanel.vue src/renderer/src/components/TicketView.vue src/renderer/src/components/LeftPanel.test.ts
git commit -m "feat(ui): open Jira tickets by key into left-panel tabs"
```

---

## Self-Review

**Spec coverage (Phase 1 scope):**
- Electron shell + two-panel layout → Tasks 1, 6 ✓
- Config load/validate (full schema, presets) → Task 2 ✓
- Jira Cloud REST v3 + API token, ADF ticket fetch → Task 3 ✓
- ADF → HTML rendering → Task 4 ✓
- Token stays in main; narrow IPC bridge → Task 5 ✓
- Ticket tabs + key input + Open → Task 7 ✓
- Raccourier palette tokens → Task 6 ✓
- Out of Phase 1 (deferred, spec-tracked): terminals (Phase 2), prompts/ADF→markdown/acceptanceCriteria extraction (Phase 3), YOLO/PR (Phase 4), CLI launch args + packaging (Phase 5), comments rendering, full impeccable design pass.

**Placeholder scan:** No TBD/TODO; every code step contains complete code; every command has expected output.

**Type consistency:** `Ticket`/`AdfNode`/`TicketComment` defined once in `src/shared/types.ts` and consumed unchanged in Tasks 3–7. `GetTicketResult` defined in `src/shared/ipc.ts` (Task 5), used by preload + LeftPanel. `renderAdfToHtml(doc: AdfNode | null): string` signature identical in Task 4 definition and Task 7 use. `registerIpc(getTicket: (key) => Promise<Ticket>)` matches its Task 8 call in `main/index.ts`.

**Note on ordering:** Task 6 intentionally leaves the app un-runnable until Task 7 (App.vue imports LeftPanel). Flagged in Task 6 Step 6. Tasks 6 and 7 should land together before the manual boot check.
```
