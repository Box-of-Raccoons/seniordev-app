# SeniorDevWatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A headless Electron system-tray process that polls Jira for the user's `SeniorDev`-labeled tickets and drives each new one through the shared Jira Orchestrator (classify → YOLO spawn), sequentially, with a tray toggle between auto-dispatch and approve-first.

**Architecture:** A second Electron entry (`src/watch/main.ts`, Tray only, no window) owns a poll timer + a sequential queue. Core orchestration lives in dependency-injected, unit-tested modules under `src/watch/`. Stage-1 classify machinery is extracted from the existing `orchestrator-handlers.ts` into a renderer-agnostic `src/main/orchestrator/run.ts` that both the IPC handler and the tray call. `JiraClient` gains JQL search + transition methods. Stage-2 spawn reuses existing `resolveExpandedPrompt` + `buildHeadlessLaunch` + `YoloRunner`.

**Tech Stack:** TypeScript (ESM), Electron 31.7.7, electron-vite, Zod, Vitest, node `fetch`. Prompts travel over stdin only.

## Global Constraints

- Branch: `feature/seniordev-watch` (already checked out, rebased onto `develop @ f75b7fc`). Verify with `git branch --show-current` before every commit.
- Commit messages: **never** add `Co-Authored-By` or any AI-attribution trailer.
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit.
- **Additive tests only** — never modify an existing `expect` in a committed test. The extraction (Task 7) must keep `src/main/ipc/orchestrator-handlers.test.ts` green **unchanged**.
- Existing baseline must stay green. Record it in Task 0 and diff after each task.
- Do not stage unrelated working-tree changes: leave `package.json`/`pnpm-lock.yaml` (an `electron` pin) and untracked files alone **except** the two `assets/raccoon-*.png` which Task 9 adds.
- Test commands: single file `pnpm exec vitest run <path>`; full suite `pnpm test`; types `pnpm typecheck`.
- Windows-first. Prompt delivery is stdin only (never argv).

---

### Task 0: Record the baseline

- [ ] **Step 1: Confirm branch and clean-ish tree**

Run: `git branch --show-current`
Expected: `feature/seniordev-watch`

- [ ] **Step 2: Record the test + typecheck baseline**

Run: `pnpm test 2>&1 | tail -20 && pnpm typecheck`
Expected: note the passing/failing counts and any pre-existing failures. All later "green" claims diff against this. (Nothing to commit.)

---

### Task 1: JiraClient — JQL search + transitions

**Files:**
- Modify: `src/main/jira/normalize.ts` (export `RawIssue`)
- Modify: `src/main/jira/client.ts`
- Test: `src/main/jira/client.test.ts` (append; do not edit existing cases)

**Interfaces:**
- Consumes: `normalizeIssue(raw, baseUrl)`, `RawIssue`, existing `JiraClient` constructor `new JiraClient(cfg, fetchFn?)`.
- Produces: `JiraClient.search(jql: string): Promise<Ticket[]>`, `JiraClient.getTransitions(key: string): Promise<JiraTransition[]>`, `JiraClient.transition(key: string, transitionName: string): Promise<void>`, `interface JiraTransition { id: string; name: string }`.

- [ ] **Step 1: Export `RawIssue` from normalize.ts**

Change the interface declaration (line 8) from `interface RawIssue {` to:

```typescript
export interface RawIssue {
```

- [ ] **Step 2: Write the failing tests (append to client.test.ts)**

```typescript
describe('JiraClient.search', () => {
  it('POSTs JQL to /search/jql and normalizes issues', async () => {
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toContain('/rest/api/3/search/jql')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string).jql).toBe('assignee = currentUser()')
      return { ok: true, status: 200, json: async () => ({ issues: [fixture] }) } as Response
    })
    const client = new JiraClient(cfg, fetchFn as unknown as typeof fetch)
    const tickets = await client.search('assignee = currentUser()')
    expect(tickets).toHaveLength(1)
    expect(tickets[0].summary).toBe('Login button dead on iOS')
  })

  it('returns [] when the response has no issues', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) } as Response))
    const client = new JiraClient(cfg, fetchFn as unknown as typeof fetch)
    expect(await client.search('x')).toEqual([])
  })

  it('throws on a non-ok search response', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 400, statusText: 'Bad Request' } as Response))
    const client = new JiraClient(cfg, fetchFn as unknown as typeof fetch)
    await expect(client.search('bad')).rejects.toThrow(/400/)
  })
})

describe('JiraClient.transition', () => {
  it('resolves the transition id by name (case-insensitive) and POSTs it', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (!init?.method || init.method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ transitions: [{ id: '31', name: 'In Progress' }] }) } as Response
      }
      return { ok: true, status: 204 } as Response
    })
    const client = new JiraClient(cfg, fetchFn as unknown as typeof fetch)
    await client.transition('PROJ-1', 'in progress')
    const post = calls.find((c) => c.init?.method === 'POST')!
    expect(post.url).toContain('/rest/api/3/issue/PROJ-1/transitions')
    expect(JSON.parse(post.init!.body as string)).toEqual({ transition: { id: '31' } })
  })

  it('throws a distinguishable error when no transition matches the name', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ transitions: [{ id: '1', name: 'Done' }] }) } as Response))
    const client = new JiraClient(cfg, fetchFn as unknown as typeof fetch)
    await expect(client.transition('PROJ-1', 'In Progress')).rejects.toThrow(/No transition named "In Progress"/)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm exec vitest run src/main/jira/client.test.ts`
Expected: FAIL — `client.search`/`client.transition` are not functions.

- [ ] **Step 4: Implement search + transitions in client.ts**

Replace the file body's imports and class with (keeping `fetchIssue` unchanged):

```typescript
import type { Ticket } from '../../shared/types'
import { normalizeIssue, type RawIssue } from './normalize'

export interface JiraConfig {
  baseUrl: string
  email: string
  apiToken: string
}

export interface JiraTransition {
  id: string
  name: string
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

  private base(): string {
    return this.cfg.baseUrl.replace(/\/$/, '')
  }

  private jsonHeaders(): Record<string, string> {
    return { Authorization: this.authHeader(), Accept: 'application/json', 'Content-Type': 'application/json' }
  }

  async fetchIssue(key: string): Promise<Ticket> {
    const url = `${this.base()}/rest/api/3/issue/${encodeURIComponent(key)}?fields=${FIELDS}`
    const res = await this.fetchFn(url, {
      headers: { Authorization: this.authHeader(), Accept: 'application/json' }
    })
    if (!res.ok) {
      throw new Error(`Jira request failed (${res.status} ${res.statusText || ''}) for ${key}`)
    }
    const raw = await res.json()
    return normalizeIssue(raw, this.base())
  }

  // Enhanced search endpoint (the old GET /rest/api/3/search is deprecated).
  // v1 takes the first page (maxResults 50); pagination is a follow-up.
  async search(jql: string): Promise<Ticket[]> {
    const res = await this.fetchFn(`${this.base()}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify({ jql, fields: FIELDS.split(','), maxResults: 50 })
    })
    if (!res.ok) throw new Error(`Jira search failed (${res.status} ${res.statusText || ''})`)
    const raw = (await res.json()) as { issues?: RawIssue[] }
    return (raw.issues ?? []).map((i) => normalizeIssue(i, this.base()))
  }

  async getTransitions(key: string): Promise<JiraTransition[]> {
    const res = await this.fetchFn(`${this.base()}/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
      headers: { Authorization: this.authHeader(), Accept: 'application/json' }
    })
    if (!res.ok) throw new Error(`Jira transitions fetch failed (${res.status}) for ${key}`)
    const raw = (await res.json()) as { transitions?: JiraTransition[] }
    return (raw.transitions ?? []).map((t) => ({ id: t.id, name: t.name }))
  }

  async transition(key: string, transitionName: string): Promise<void> {
    const match = (await this.getTransitions(key)).find(
      (t) => t.name.toLowerCase() === transitionName.toLowerCase()
    )
    if (!match) throw new Error(`No transition named "${transitionName}" available on ${key}`)
    const res = await this.fetchFn(`${this.base()}/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify({ transition: { id: match.id } })
    })
    if (!res.ok) throw new Error(`Jira transition failed (${res.status}) for ${key}`)
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run src/main/jira/client.test.ts`
Expected: PASS (existing `fetchIssue` cases + new search/transition cases).

- [ ] **Step 6: Commit**

```bash
git add src/main/jira/client.ts src/main/jira/normalize.ts src/main/jira/client.test.ts
git commit -m "feat(jira): add JQL search and status transitions to JiraClient"
```

---

### Task 2: Config — WatchSchema

**Files:**
- Modify: `src/main/config/schema.ts`
- Test: `src/main/config/schema.test.ts` (append)

**Interfaces:**
- Produces: `WatchSchema`, `type WatchConfig = z.infer<typeof WatchSchema>`, and `config.watch` on `Config` (always present via `.default({})`).

- [ ] **Step 1: Write the failing test (append to schema.test.ts)**

```typescript
describe('WatchSchema', () => {
  it('fills defaults when watch is absent (disabled)', () => {
    const cfg = ConfigSchema.parse({ jira: { baseUrl: 'https://x.atlassian.net', email: 'a@b.co', apiToken: 't' } })
    expect(cfg.watch).toEqual({
      enabled: false,
      intervalSeconds: 300,
      label: 'SeniorDev',
      triggerStatusCategory: 'To Do',
      transitionOnDispatch: 'In Progress',
      autoMode: false
    })
  })

  it('accepts overrides', () => {
    const cfg = ConfigSchema.parse({
      jira: { baseUrl: 'https://x.atlassian.net', email: 'a@b.co', apiToken: 't' },
      watch: { enabled: true, intervalSeconds: 60, autoMode: true }
    })
    expect(cfg.watch.enabled).toBe(true)
    expect(cfg.watch.intervalSeconds).toBe(60)
    expect(cfg.watch.autoMode).toBe(true)
    expect(cfg.watch.label).toBe('SeniorDev')
  })

  it('rejects a non-positive interval', () => {
    expect(() =>
      ConfigSchema.parse({ jira: { baseUrl: 'https://x.atlassian.net', email: 'a@b.co', apiToken: 't' }, watch: { intervalSeconds: 0 } })
    ).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/main/config/schema.test.ts`
Expected: FAIL — `cfg.watch` is undefined.

- [ ] **Step 3: Add WatchSchema and wire it into ConfigSchema**

In `src/main/config/schema.ts`, add before `ConfigSchema`:

```typescript
export const WatchSchema = z.object({
  enabled: z.boolean().default(false),
  intervalSeconds: z.number().int().positive().default(300),
  label: z.string().min(1).default('SeniorDev'),
  triggerStatusCategory: z.string().min(1).default('To Do'),
  transitionOnDispatch: z.string().min(1).default('In Progress'),
  autoMode: z.boolean().default(false)
})

export type WatchConfig = z.infer<typeof WatchSchema>
```

Then add this line inside the `ConfigSchema` object (e.g. after `repos`):

```typescript
  watch: WatchSchema.default({}),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/main/config/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/config/schema.ts src/main/config/schema.test.ts
git commit -m "feat(config): add watch block schema for SeniorDevWatch"
```

---

### Task 3: `src/watch/jql.ts` — build the query

**Files:**
- Create: `src/watch/jql.ts`
- Test: `src/watch/jql.test.ts`

**Interfaces:**
- Consumes: `WatchConfig` from `../main/config/schema`.
- Produces: `buildJql(watch: WatchConfig): string`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { buildJql } from './jql'
import { WatchSchema } from '../main/config/schema'

const watch = WatchSchema.parse({})

describe('buildJql', () => {
  it('builds assignee + label + status-category query', () => {
    expect(buildJql(watch)).toBe(
      'assignee = currentUser() AND labels = "SeniorDev" AND statusCategory = "To Do"'
    )
  })

  it('reflects custom label and trigger status', () => {
    const w = WatchSchema.parse({ label: 'Auto', triggerStatusCategory: 'Backlog' })
    expect(buildJql(w)).toBe(
      'assignee = currentUser() AND labels = "Auto" AND statusCategory = "Backlog"'
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/watch/jql.test.ts`
Expected: FAIL — cannot find `./jql`.

- [ ] **Step 3: Implement jql.ts**

```typescript
import type { WatchConfig } from '../main/config/schema'

// Escape a double-quote so a label/status containing one can't break out of the
// JQL string literal.
function q(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`
}

export function buildJql(watch: WatchConfig): string {
  return `assignee = currentUser() AND labels = ${q(watch.label)} AND statusCategory = ${q(watch.triggerStatusCategory)}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/watch/jql.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/watch/jql.ts src/watch/jql.test.ts
git commit -m "feat(watch): build SeniorDev poll JQL"
```

---

### Task 4: `src/watch/repo-map.ts` — ticket → repo

**Files:**
- Create: `src/watch/repo-map.ts`
- Test: `src/watch/repo-map.test.ts`

**Interfaces:**
- Consumes: `Config` from `../main/config/schema`.
- Produces: `findRepoForTicket(config: Config, ticketKey: string): Config['repos'][number] | null`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { findRepoForTicket } from './repo-map'
import { ConfigSchema, type Config } from '../main/config/schema'

const config: Config = ConfigSchema.parse({
  jira: { baseUrl: 'https://x.atlassian.net', email: 'a@b.co', apiToken: 't' },
  repos: [
    { key: 'SD', path: 'C:/repos/seniordev' },
    { key: 'AB', path: 'C:/repos/ab' }
  ]
})

describe('findRepoForTicket', () => {
  it('matches the project segment case-insensitively', () => {
    expect(findRepoForTicket(config, 'sd-6')?.path).toBe('C:/repos/seniordev')
  })

  it('matches on the segment before the dash, not a bare prefix', () => {
    // "AB" must not capture "ABC-1"
    expect(findRepoForTicket(config, 'ABC-1')).toBeNull()
  })

  it('returns null when no repo matches', () => {
    expect(findRepoForTicket(config, 'ZZ-9')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/watch/repo-map.test.ts`
Expected: FAIL — cannot find `./repo-map`.

- [ ] **Step 3: Implement repo-map.ts**

```typescript
import type { Config } from '../main/config/schema'

// Mirrors resolveCwd's project-segment match (terminal/resolve.ts) but reports a
// miss as null instead of falling back to homedir — the watcher must SKIP a
// ticket with no configured repo, not run it in the wrong place.
export function findRepoForTicket(config: Config, ticketKey: string): Config['repos'][number] | null {
  const project = ticketKey.split('-')[0]?.toUpperCase()
  if (!project) return null
  return config.repos.find((r) => r.key.toUpperCase() === project) ?? null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/watch/repo-map.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/watch/repo-map.ts src/watch/repo-map.test.ts
git commit -m "feat(watch): map a ticket key to a configured repo"
```

---

### Task 5: `src/watch/state.ts` — dedup + autoMode persistence

**Files:**
- Create: `src/watch/state.ts`
- Test: `src/watch/state.test.ts`

**Interfaces:**
- Produces: `class WatchState` with `has(key): boolean`, `record(key, outcome: 'spawned'|'failed', at: string): void`, `clear(key): void`, `getAutoMode(): boolean | undefined`, `setAutoMode(v: boolean): void`; types `DispatchOutcome = 'spawned' | 'failed'`, `WatchStateData`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WatchState } from './state'

let path: string
beforeEach(() => { path = join(mkdtempSync(join(tmpdir(), 'sd-watch-')), 'watch-state.json') })

describe('WatchState', () => {
  it('records and reports dispatched keys, persisting across instances', () => {
    const s = new WatchState(path)
    expect(s.has('SD-1')).toBe(false)
    s.record('SD-1', 'spawned', '2026-07-03T00:00:00.000Z')
    expect(s.has('SD-1')).toBe(true)
    // A fresh instance reads the file back.
    expect(new WatchState(path).has('SD-1')).toBe(true)
  })

  it('clear() removes a key (retry path)', () => {
    const s = new WatchState(path)
    s.record('SD-2', 'failed', 'now')
    s.clear('SD-2')
    expect(s.has('SD-2')).toBe(false)
  })

  it('persists autoMode independently of config', () => {
    const s = new WatchState(path)
    expect(s.getAutoMode()).toBeUndefined()
    s.setAutoMode(true)
    expect(new WatchState(path).getAutoMode()).toBe(true)
  })

  it('tolerates a missing or corrupt file', () => {
    // Missing file:
    expect(new WatchState(path).has('x')).toBe(false)
    // Corrupt file:
    const s = new WatchState(path)
    s.record('SD-3', 'spawned', 'now')
    require('node:fs').writeFileSync(path, 'not json', 'utf8')
    expect(new WatchState(path).has('SD-3')).toBe(false)
  })

  it('writes valid JSON', () => {
    const s = new WatchState(path)
    s.record('SD-4', 'spawned', '2026-07-03T00:00:00.000Z')
    const data = JSON.parse(readFileSync(path, 'utf8'))
    expect(data.dispatched['SD-4']).toEqual({ at: '2026-07-03T00:00:00.000Z', outcome: 'spawned' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/watch/state.test.ts`
Expected: FAIL — cannot find `./state`.

- [ ] **Step 3: Implement state.ts**

```typescript
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type DispatchOutcome = 'spawned' | 'failed'
export interface DispatchRecord { at: string; outcome: DispatchOutcome }
export interface WatchStateData {
  autoMode?: boolean
  dispatched: Record<string, DispatchRecord>
}

// Local dedup + runtime autoMode. The state file lives next to config.yaml and
// is the belt to the status-transition suspenders: even if a transition fails or
// is misconfigured, a recorded key is not re-dispatched.
export class WatchState {
  private data: WatchStateData = { dispatched: {} }

  constructor(private readonly path: string) {
    if (existsSync(this.path)) {
      try {
        const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<WatchStateData>
        this.data = { autoMode: parsed.autoMode, dispatched: parsed.dispatched ?? {} }
      } catch {
        // Corrupt file → start clean rather than crash the tray on boot.
        this.data = { dispatched: {} }
      }
    }
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
    renameSync(tmp, this.path)
  }

  has(key: string): boolean {
    return key in this.data.dispatched
  }

  record(key: string, outcome: DispatchOutcome, at: string): void {
    this.data.dispatched[key] = { at, outcome }
    this.save()
  }

  clear(key: string): void {
    delete this.data.dispatched[key]
    this.save()
  }

  getAutoMode(): boolean | undefined {
    return this.data.autoMode
  }

  setAutoMode(v: boolean): void {
    this.data.autoMode = v
    this.save()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/watch/state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/watch/state.ts src/watch/state.test.ts
git commit -m "feat(watch): dedup + autoMode state file"
```

---

### Task 6: `src/watch/queue.ts` — sequential FIFO runner

**Files:**
- Create: `src/watch/queue.ts`
- Test: `src/watch/queue.test.ts`

**Interfaces:**
- Produces: `class SequentialQueue` with `enqueue(job: () => Promise<void>): void`, getters `size: number` and `active: boolean`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { SequentialQueue } from './queue'

// A deferred lets the test control exactly when each job finishes.
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

describe('SequentialQueue', () => {
  const settle = (): Promise<void> => new Promise((r) => setImmediate(r))

  it('runs jobs one at a time in FIFO order', async () => {
    const q = new SequentialQueue()
    const order: number[] = []
    const d1 = deferred()
    const d2 = deferred()
    let started2 = false

    q.enqueue(async () => { order.push(1); await d1.promise; order.push(11) })
    q.enqueue(async () => { started2 = true; order.push(2); await d2.promise; order.push(22) })

    await settle()
    // Job 2 must not have started while job 1 is still pending.
    expect(started2).toBe(false)
    d1.resolve()
    await settle()
    expect(started2).toBe(true)
    d2.resolve()
    await settle()
    expect(order).toEqual([1, 11, 2, 22])
  })

  it('continues after a job throws', async () => {
    const q = new SequentialQueue()
    const ran: string[] = []
    q.enqueue(async () => { ran.push('a'); throw new Error('boom') })
    q.enqueue(async () => { ran.push('b') })
    await new Promise((r) => setImmediate(r))
    expect(ran).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/watch/queue.test.ts`
Expected: FAIL — cannot find `./queue`.

- [ ] **Step 3: Implement queue.ts**

```typescript
// One job at a time, FIFO. A throwing job is swallowed so the queue keeps
// draining — the dispatcher already reports per-ticket failures via notify.
export class SequentialQueue {
  private jobs: Array<() => Promise<void>> = []
  private running = false

  get size(): number {
    return this.jobs.length
  }

  get active(): boolean {
    return this.running
  }

  enqueue(job: () => Promise<void>): void {
    this.jobs.push(job)
    void this.drain()
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.jobs.length) {
        const job = this.jobs.shift()!
        await job().catch(() => {})
      }
    } finally {
      this.running = false
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/watch/queue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/watch/queue.ts src/watch/queue.test.ts
git commit -m "feat(watch): sequential FIFO queue"
```

---

### Task 7: Extract `src/main/orchestrator/run.ts` and refactor the handler

**Files:**
- Create: `src/main/orchestrator/run.ts`
- Create: `src/main/orchestrator/run.test.ts`
- Modify: `src/main/ipc/orchestrator-handlers.ts`
- Modify: `src/main/index.ts` (line 44 type only)
- Do NOT modify: `src/main/ipc/orchestrator-handlers.test.ts` (must stay green unchanged)

**Interfaces:**
- Consumes: `Config`, `ConfigSource`, `ClassifyRequest`, `ClassifyResult`, `buildHeadlessLaunch`+`HeadlessLaunch`, `createParser`, `YoloRunner`+`HeadlessSpawner`, `buildForgePatterns`+`ForgePattern`, `buildPromptTicket`/`expandPrompt`/`resolveForge`, `findPrompt`+`PromptTemplate`, `readOrchestratorFile`, `buildCatalog`, `extractVerdict`, `ResolvedCommand`.
- Produces:
  - `finalize(exitCode: number, buffer: string, prompts: PromptTemplate[]): ClassifyResult`
  - `buildClassifyLaunch(config, source, promptsDir, req, resolveCommand?): Promise<HeadlessLaunch>`
  - `createClassifyRunner(spawner, onLog): ClassifyEngine` where
    `interface ClassifyEngine { run(id, launch, prompts, patterns): Promise<ClassifyResult>; has(id): boolean; kill(id): void; killAll(): void }`

- [ ] **Step 1: Write the failing test for run.ts**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { finalize, buildClassifyLaunch, createClassifyRunner } from './run'
import { ConfigSchema } from '../config/schema'
import type { HeadlessChild } from '../headless/runner'
import type { PromptTemplate } from '../prompts/library'
import type { Ticket } from '../../shared/types'

const prompts: PromptTemplate[] = [{ name: 'fix-bug', description: 'fixes bugs', body: 'Work {{ticket.key}}' }]

describe('finalize', () => {
  it('non-zero exit → failure', () => {
    expect(finalize(1, '{"prompt":"fix-bug"}', prompts)).toEqual({ ok: false, reason: 'classifier exited with code 1' })
  })
  it('no JSON → failure', () => {
    expect(finalize(0, 'nope', prompts)).toEqual({ ok: false, reason: 'classifier returned no JSON verdict' })
  })
  it('null verdict carries the reason', () => {
    expect(finalize(0, '{"prompt":null,"reason":"no fit"}', prompts)).toEqual({ ok: false, reason: 'no fit' })
  })
  it('unknown name → failure', () => {
    expect(finalize(0, '{"prompt":"ghost"}', prompts)).toEqual({ ok: false, reason: 'classifier chose unknown playbook "ghost"' })
  })
  it('known name → ok', () => {
    expect(finalize(0, '{"prompt":"fix-bug"}', prompts)).toEqual({ ok: true, prompt: 'fix-bug' })
  })
})

const config = ConfigSchema.parse({
  jira: { baseUrl: 'https://x.atlassian.net', email: 'a@b.co', apiToken: 't' },
  cliTools: { claude: { command: 'claude', headless: { args: ['-p'], outputParser: 'text' } } },
  repos: [{ key: 'PROJ', path: 'C:/repos/proj' }]
})
const ticket: Ticket = { key: 'PROJ-1', type: 'Bug', status: 'Open', summary: 'boom', descriptionAdf: null, acceptanceCriteria: null, comments: [], url: 'u' }
const source = { config, loadError: null, prompts, getTicket: async () => ticket }

describe('buildClassifyLaunch', () => {
  it('builds a bare (no preamble/recap) launch carrying ticket + catalog', async () => {
    const launch = await buildClassifyLaunch(config, source, 'C:/nonexistent-prompts', { id: 'c1', ticketKey: 'PROJ-1' })
    expect(launch.file).toBe('claude')
    // bare:true → the classify prompt is NOT wrapped by the YOLO preamble.
    expect(launch.prompt).not.toContain('headless, autonomous session')
    expect(launch.prompt).toContain('boom')      // ticket summary
    expect(launch.prompt).toContain('fix-bug')   // catalog entry
  })
})

function fakeChild(): HeadlessChild & { stdout: (c: string) => void; exit: (n: number) => void } {
  const child = {
    stdout: (_: string) => {}, exit: (_: number) => {},
    onStdout(cb: (c: string) => void) { child.stdout = cb },
    onStderr() {},
    onExit(cb: (n: number) => void) { child.exit = cb },
    writeAndCloseStdin() {},
    kill() {}
  }
  return child
}

describe('createClassifyRunner', () => {
  it('streams via onLog and resolves through finalize', async () => {
    const child = fakeChild()
    const onLog = vi.fn()
    const engine = createClassifyRunner(() => child, onLog)
    const launch = await buildClassifyLaunch(config, source, 'C:/nope', { id: 'c1', ticketKey: 'PROJ-1' })
    const p = engine.run('c1', launch, prompts, [])
    child.stdout('{"prompt":"fix-bug"}\n')
    expect(onLog).toHaveBeenCalledWith('c1', '{"prompt":"fix-bug"}')
    child.exit(0)
    expect(await p).toEqual({ ok: true, prompt: 'fix-bug' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/main/orchestrator/run.test.ts`
Expected: FAIL — cannot find `./run`.

- [ ] **Step 3: Implement run.ts**

```typescript
import type { Config } from '../config/schema'
import type { ConfigSource } from '../config/store'
import type { ClassifyRequest, ClassifyResult } from '../../shared/ipc'
import { buildHeadlessLaunch, type HeadlessLaunch } from '../headless/launch'
import { createParser } from '../headless/parsers'
import { YoloRunner, type HeadlessSpawner } from '../headless/runner'
import type { ForgePattern } from '../terminal/pr-detector'
import { buildPromptTicket, expandPrompt, resolveForge } from '../prompts/expand'
import { findPrompt, type PromptTemplate } from '../prompts/library'
import { readOrchestratorFile } from '../prompts/files'
import { buildCatalog } from './catalog'
import { extractVerdict } from './extract'
import type { ResolvedCommand } from '../terminal/resolve-command'

// Never guess-and-run: any failure (non-zero exit, no verdict, explicit null,
// unknown name) yields ok:false so stage 2 is unreachable.
export function finalize(exitCode: number, buffer: string, prompts: PromptTemplate[]): ClassifyResult {
  if (exitCode !== 0) return { ok: false, reason: `classifier exited with code ${exitCode}` }
  const verdict = extractVerdict(buffer)
  if (!verdict) return { ok: false, reason: 'classifier returned no JSON verdict' }
  if (verdict.prompt === null) return { ok: false, reason: verdict.reason ?? 'no playbook fits this ticket' }
  if (!findPrompt(prompts, verdict.prompt)) return { ok: false, reason: `classifier chose unknown playbook "${verdict.prompt}"` }
  return { ok: true, prompt: verdict.prompt }
}

// Stage-1 launch: full ticket (ignore config.ticketContext privacy mode — a
// classifier routing on a bare key returns garbage) + catalog, bare:true so no
// yoloPreamble/recap wraps the "answer with only JSON" contract.
export async function buildClassifyLaunch(
  config: Config,
  source: ConfigSource,
  promptsDir: string,
  req: ClassifyRequest,
  resolveCommand?: (command: string) => ResolvedCommand | undefined
): Promise<HeadlessLaunch> {
  const template = readOrchestratorFile(promptsDir)
  const ticket = await source.getTicket(req.ticketKey)
  const ticketCtx = buildPromptTicket(ticket, 'both')
  const forge = resolveForge(config, req.ticketKey)
  const expanded = expandPrompt(template, {
    ticket: ticketCtx,
    forge,
    contextTemplate: source.contextTemplate?.(),
    catalog: buildCatalog(source.prompts)
  })
  return buildHeadlessLaunch(config, { tool: req.tool, ticketKey: req.ticketKey, bare: true }, expanded, resolveCommand)
}

export interface ClassifyEngine {
  run(id: string, launch: HeadlessLaunch, prompts: PromptTemplate[], patterns: ForgePattern[]): Promise<ClassifyResult>
  has(id: string): boolean
  kill(id: string): void
  killAll(): void
}

// Owns a YoloRunner and, per run id, accumulates stdout for verdict extraction
// and holds the promise resolver its exit settles.
export function createClassifyRunner(
  spawner: HeadlessSpawner,
  onLog: (id: string, text: string) => void
): ClassifyEngine {
  const buffers = new Map<string, string>()
  const pending = new Map<string, (r: ClassifyResult) => void>()
  const promptsById = new Map<string, PromptTemplate[]>()

  const runner = new YoloRunner(spawner, {
    onLog: (id, text) => {
      onLog(id, text)
      buffers.set(id, (buffers.get(id) ?? '') + text + '\n')
    },
    onPr: () => {}, // a classify-only turn must not open PRs
    onExit: (id, e) => {
      const resolve = pending.get(id)
      const buffer = buffers.get(id) ?? ''
      const prompts = promptsById.get(id) ?? []
      pending.delete(id)
      buffers.delete(id)
      promptsById.delete(id)
      resolve?.(finalize(e.exitCode, buffer, prompts))
    }
  })

  return {
    has: (id) => runner.has(id),
    kill: (id) => runner.kill(id),
    killAll: () => runner.killAll(),
    run(id, launch, prompts, patterns) {
      return new Promise<ClassifyResult>((resolve) => {
        pending.set(id, resolve)
        buffers.set(id, '')
        promptsById.set(id, prompts)
        runner.start(id, {
          file: launch.file,
          args: launch.args,
          cwd: launch.cwd,
          prompt: launch.prompt,
          parser: createParser(launch.outputParser, launch.sessionIdPattern),
          patterns,
          resolved: launch.resolved
        })
      })
    }
  }
}
```

- [ ] **Step 4: Run run.test.ts to verify it passes**

Run: `pnpm exec vitest run src/main/orchestrator/run.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor orchestrator-handlers.ts to call run.ts (behavior-preserving)**

Replace the `finalize` function (lines ~20-29) and the `classify` handler body so the handler delegates. The new file:

```typescript
import { ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { requireConfig } from '../config/store'
import {
  CONFIG, ORCHESTRATOR, YOLO,
  type ClassifyRequest, type ClassifyResult, type OrchestratorPromptInfo, type SaveResult
} from '../../shared/ipc'
import { buildForgePatterns } from '../terminal/pr-detector'
import { type HeadlessSpawner } from '../headless/runner'
import { ORCHESTRATOR_FILE, readOrchestratorFile, writeOrchestratorFile } from '../prompts/files'
import { buildClassifyLaunch, createClassifyRunner, type ClassifyEngine } from '../orchestrator/run'
import type { TerminalDeps } from './terminal-handlers'

export function registerOrchestratorIpc(
  getSender: () => Electron.WebContents | undefined,
  spawner: HeadlessSpawner,
  deps: TerminalDeps & { promptsDir: () => string }
): ClassifyEngine {
  const engine = createClassifyRunner(spawner, (id, text) => getSender()?.send(YOLO.log, { id, text }))

  ipcMain.handle(ORCHESTRATOR.classify, async (_e, req: ClassifyRequest): Promise<ClassifyResult> => {
    try {
      const config = requireConfig(deps.source)
      // Check BEFORE building: a duplicate id must not clobber the live run.
      if (engine.has(req.id)) return { ok: false, reason: 'run already exists' }
      const launch = await buildClassifyLaunch(config, deps.source, deps.promptsDir(), req, deps.resolveCommand)
      return await engine.run(req.id, launch, deps.source.prompts, buildForgePatterns(config))
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  })

  // A killed child still fires its exit callback (non-zero), which resolves the
  // pending classify as a failure.
  ipcMain.on(ORCHESTRATOR.kill, (_e, id: string) => engine.kill(id))

  ipcMain.handle(ORCHESTRATOR.readPrompt, (): OrchestratorPromptInfo => ({
    text: readOrchestratorFile(deps.promptsDir()),
    isDefault: !existsSync(join(deps.promptsDir(), ORCHESTRATOR_FILE))
  }))

  ipcMain.handle(ORCHESTRATOR.savePrompt, (_e, text: string): SaveResult => {
    try {
      writeOrchestratorFile(deps.promptsDir(), text)
      getSender()?.send(CONFIG.changed)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  return engine
}
```

- [ ] **Step 6: Update the `orchestrator` variable type in index.ts**

In `src/main/index.ts`, change line 44 from:

```typescript
let orchestrator: YoloRunner | null = null
```

to:

```typescript
let orchestrator: import('./orchestrator/run').ClassifyEngine | null = null
```

(The `YoloRunner` import may now be unused only for this var — leave the import; `yolo` still uses it. `orchestrator?.killAll()` still type-checks via `ClassifyEngine`.)

- [ ] **Step 7: Run the orchestrator handler test (must be green, UNCHANGED) + run.test.ts**

Run: `pnpm exec vitest run src/main/ipc/orchestrator-handlers.test.ts src/main/orchestrator/run.test.ts`
Expected: PASS — all 10 handler cases plus the run.ts cases. If any handler case fails, the refactor diverged from the original behavior; fix run.ts/handler, do not touch the test.

- [ ] **Step 8: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/main/orchestrator/run.ts src/main/orchestrator/run.test.ts src/main/ipc/orchestrator-handlers.ts src/main/index.ts
git commit -m "refactor(orchestrator): extract renderer-agnostic classify runner (run.ts)"
```

---

### Task 8: `src/watch/dispatcher.ts` — the poll→dispatch core

**Files:**
- Create: `src/watch/dispatcher.ts`
- Test: `src/watch/dispatcher.test.ts`

**Interfaces:**
- Consumes: `Config` (`../main/config/schema`), `Ticket` (`../shared/types`), `ClassifyResult` (`../shared/ipc`), `buildJql`, `findRepoForTicket`, `SequentialQueue`, `WatchState`.
- Produces:
  - `interface WatchNotification { title: string; body: string; ticketKey?: string; onClick?: () => void }`
  - `interface DispatcherDeps { config: () => Config; search: (jql: string) => Promise<Ticket[]>; transition: (key: string, name: string) => Promise<void>; classify: (ticket: Ticket, repoPath: string) => Promise<ClassifyResult>; spawn: (ticket: Ticket, repoPath: string, promptName: string) => Promise<{ exitCode: number; prUrls: string[] }>; state: WatchState; notify: (n: WatchNotification) => void; isAuto: () => boolean; now: () => string }`
  - `class WatchDispatcher` with `poll(): Promise<void>`, `approve(key: string): void`, getters `pendingCount: number`, `inFlightCount: number`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WatchDispatcher, type DispatcherDeps, type WatchNotification } from './dispatcher'
import { WatchState } from './state'
import { ConfigSchema, type Config } from '../main/config/schema'
import type { Ticket } from '../shared/types'

const config: Config = ConfigSchema.parse({
  jira: { baseUrl: 'https://x.atlassian.net', email: 'a@b.co', apiToken: 't' },
  repos: [{ key: 'SD', path: 'C:/repos/sd' }],
  watch: { enabled: true, transitionOnDispatch: 'In Progress' }
})
const ticket = (key: string): Ticket => ({ key, type: 'Bug', status: 'To Do', summary: `sum ${key}`, descriptionAdf: null, acceptanceCriteria: null, comments: [], url: 'u' })

function makeDeps(over: Partial<DispatcherDeps> = {}): { deps: DispatcherDeps; notes: WatchNotification[] } {
  const notes: WatchNotification[] = []
  const path = join(mkdtempSync(join(tmpdir(), 'sd-disp-')), 'state.json')
  const deps: DispatcherDeps = {
    config: () => config,
    search: async () => [ticket('SD-1')],
    transition: vi.fn(async () => {}),
    classify: vi.fn(async () => ({ ok: true, prompt: 'fix-bug' })),
    spawn: vi.fn(async () => ({ exitCode: 0, prUrls: ['https://github.com/o/r/pull/1'] })),
    state: new WatchState(path),
    notify: (n) => notes.push(n),
    isAuto: () => true,
    now: () => '2026-07-03T00:00:00.000Z',
    ...over
  }
  return { deps, notes }
}

const settle = () => new Promise((r) => setImmediate(r))

describe('WatchDispatcher', () => {
  it('auto: classify→spawn→record+transition→notify done', async () => {
    const { deps, notes } = makeDeps()
    const d = new WatchDispatcher(deps)
    await d.poll()
    await settle()
    expect(deps.classify).toHaveBeenCalledTimes(1)
    expect(deps.spawn).toHaveBeenCalledWith(expect.objectContaining({ key: 'SD-1' }), 'C:/repos/sd', 'fix-bug')
    expect(deps.transition).toHaveBeenCalledWith('SD-1', 'In Progress')
    expect(deps.state.has('SD-1')).toBe(true)
    expect(notes.some((n) => n.title.startsWith('Done'))).toBe(true)
  })

  it('no matching repo: notify + skip, no classify, not recorded', async () => {
    const { deps, notes } = makeDeps({ search: async () => [ticket('ZZ-9')] })
    await new WatchDispatcher(deps).poll()
    await settle()
    expect(deps.classify).not.toHaveBeenCalled()
    expect(deps.state.has('ZZ-9')).toBe(false)
    expect(notes.some((n) => n.title.includes('no repo'))).toBe(true)
  })

  it('classify failure: record failed, notify, NO transition, NO spawn', async () => {
    const { deps, notes } = makeDeps({ classify: vi.fn(async () => ({ ok: false, reason: 'no fit' })) })
    await new WatchDispatcher(deps).poll()
    await settle()
    expect(deps.spawn).not.toHaveBeenCalled()
    expect(deps.transition).not.toHaveBeenCalled()
    expect(deps.state.has('SD-1')).toBe(true)
    expect(notes.some((n) => n.body === 'no fit')).toBe(true)
  })

  it('dedup: an already-recorded key is skipped', async () => {
    const { deps } = makeDeps()
    deps.state.record('SD-1', 'spawned', 'earlier')
    await new WatchDispatcher(deps).poll()
    await settle()
    expect(deps.classify).not.toHaveBeenCalled()
  })

  it('approve mode: notifies with onClick, runs only after approve()', async () => {
    const { deps, notes } = makeDeps({ isAuto: () => false })
    const d = new WatchDispatcher(deps)
    await d.poll()
    await settle()
    expect(deps.classify).not.toHaveBeenCalled()
    const note = notes.find((n) => n.ticketKey === 'SD-1' && n.onClick)!
    note.onClick!()
    await settle()
    expect(deps.classify).toHaveBeenCalledTimes(1)
  })

  it('search failure: notify, no crash', async () => {
    const { deps, notes } = makeDeps({ search: async () => { throw new Error('boom') } })
    await new WatchDispatcher(deps).poll()
    await settle()
    expect(notes.some((n) => n.title.includes('poll failed'))).toBe(true)
  })

  it('transition failure: still spawns, notifies the transition error', async () => {
    const { deps, notes } = makeDeps({ transition: vi.fn(async () => { throw new Error('no workflow') }) })
    await new WatchDispatcher(deps).poll()
    await settle()
    expect(deps.spawn).toHaveBeenCalledTimes(1)
    expect(notes.some((n) => n.title.includes('Transition failed'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/watch/dispatcher.test.ts`
Expected: FAIL — cannot find `./dispatcher`.

- [ ] **Step 3: Implement dispatcher.ts**

```typescript
import type { Config } from '../main/config/schema'
import type { Ticket } from '../shared/types'
import type { ClassifyResult } from '../shared/ipc'
import { buildJql } from './jql'
import { findRepoForTicket } from './repo-map'
import { SequentialQueue } from './queue'
import type { WatchState } from './state'

export interface WatchNotification {
  title: string
  body: string
  ticketKey?: string
  onClick?: () => void
}

export interface DispatcherDeps {
  config: () => Config
  search: (jql: string) => Promise<Ticket[]>
  transition: (key: string, name: string) => Promise<void>
  classify: (ticket: Ticket, repoPath: string) => Promise<ClassifyResult>
  spawn: (ticket: Ticket, repoPath: string, promptName: string) => Promise<{ exitCode: number; prUrls: string[] }>
  state: WatchState
  notify: (n: WatchNotification) => void
  isAuto: () => boolean
  now: () => string
}

// Poll → filter (deduped by state + in-flight + pending) → enqueue (auto) or hold
// for approval → sequential classify→spawn. Transition + record happen once the
// stage-2 run is committed, so the ticket leaves the query and is never
// re-dispatched. A classify failure records 'failed' (no transition) so a
// non-routable ticket doesn't storm the classifier every tick.
export class WatchDispatcher {
  private readonly queue = new SequentialQueue()
  private readonly inFlight = new Set<string>()
  private readonly pending = new Map<string, { ticket: Ticket; repoPath: string }>()
  private polling = false

  constructor(private readonly deps: DispatcherDeps) {}

  get pendingCount(): number {
    return this.pending.size
  }

  get inFlightCount(): number {
    return this.inFlight.size
  }

  async poll(): Promise<void> {
    if (this.polling) return // suppress overlapping ticks
    this.polling = true
    try {
      const cfg = this.deps.config()
      let tickets: Ticket[]
      try {
        tickets = await this.deps.search(buildJql(cfg.watch))
      } catch (err) {
        this.deps.notify({ title: 'Jira poll failed', body: this.msg(err) })
        return
      }
      for (const t of tickets) {
        const key = t.key
        if (this.deps.state.has(key) || this.inFlight.has(key) || this.pending.has(key)) continue
        const repo = findRepoForTicket(cfg, key)
        if (!repo) {
          this.deps.notify({ title: `${key}: no repo configured`, body: t.summary, ticketKey: key })
          continue
        }
        if (this.deps.isAuto()) {
          this.enqueue(t, repo.path)
        } else {
          this.pending.set(key, { ticket: t, repoPath: repo.path })
          this.deps.notify({ title: `Approve ${key}?`, body: t.summary, ticketKey: key, onClick: () => this.approve(key) })
        }
      }
    } finally {
      this.polling = false
    }
  }

  approve(key: string): void {
    const held = this.pending.get(key)
    if (!held) return
    this.pending.delete(key)
    this.enqueue(held.ticket, held.repoPath)
  }

  private enqueue(ticket: Ticket, repoPath: string): void {
    this.queue.enqueue(() => this.dispatch(ticket, repoPath))
  }

  private async dispatch(ticket: Ticket, repoPath: string): Promise<void> {
    const key = ticket.key
    this.inFlight.add(key)
    try {
      const verdict = await this.deps.classify(ticket, repoPath)
      if (!verdict.ok) {
        this.deps.state.record(key, 'failed', this.deps.now())
        this.deps.notify({ title: `Routing failed: ${key}`, body: verdict.reason, ticketKey: key })
        return
      }
      // Commit the run: record + leave the query BEFORE the long stage-2 run so a
      // re-poll can't re-dispatch it.
      this.deps.state.record(key, 'spawned', this.deps.now())
      try {
        await this.deps.transition(key, this.deps.config().watch.transitionOnDispatch)
      } catch (err) {
        this.deps.notify({ title: `Transition failed: ${key}`, body: this.msg(err), ticketKey: key })
      }
      this.deps.notify({ title: `Running ${verdict.prompt} on ${key}`, body: ticket.summary, ticketKey: key })
      const res = await this.deps.spawn(ticket, repoPath, verdict.prompt)
      const body = res.prUrls.length
        ? res.prUrls.join(', ')
        : res.exitCode === 0 ? 'no PR detected' : `run exited ${res.exitCode}`
      this.deps.notify({ title: `Done: ${key} (${verdict.prompt})`, body, ticketKey: key })
    } finally {
      this.inFlight.delete(key)
    }
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/watch/dispatcher.test.ts`
Expected: PASS (all 7 cases).

- [ ] **Step 5: Commit**

```bash
git add src/watch/dispatcher.ts src/watch/dispatcher.test.ts
git commit -m "feat(watch): poll→classify→spawn dispatcher core"
```

---

### Task 9: Tray entry, build wiring, docs

**Files:**
- Create: `src/watch/main.ts`
- Modify: `electron.vite.config.ts`
- Modify: `package.json` (add scripts only — do not touch deps)
- Modify: `config.example.yaml`
- Modify: `README.md`
- Add: `assets/raccoon-asleep.png`, `assets/raccoon-hardhat.png` (already untracked in the tree — commit them here as the tray icons)

**Interfaces:**
- Consumes everything above plus `ConfigStore`, `resolveConfigPath`-style pathing, `nodeHeadlessSpawner`, `systemResolveCommand`, `buildHeadlessLaunch`, `createParser`, `YoloRunner`, `buildForgePatterns`, `resolveExpandedPrompt`, `defaultConfigDir`.
- Produces: a runnable tray process at `out/main/watch.js` via `pnpm watch`.

> This task's deliverable is a running tray, verified by the manual smoke checklist in Step 7 (Electron Tray/Notification wiring isn't unit-tested; all testable logic lives in Tasks 1-8).

- [ ] **Step 1: Add the second main entry to electron.vite.config.ts**

Replace the `main` field:

```typescript
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          watch: resolve('src/watch/main.ts')
        }
      }
    }
  },
```

- [ ] **Step 2: Add scripts to package.json**

Add to `"scripts"` (leave dependencies untouched):

```json
    "watch": "electron-vite build && electron out/main/watch.js",
    "watch:build": "electron-vite build"
```

- [ ] **Step 3: Implement the tray entry src/watch/main.ts**

```typescript
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
    // Stage-2 YOLO runner: resolve each run's exit into a promise for the queue.
    const yolo = new YoloRunner(nodeHeadlessSpawner, {
      onLog: () => {},
      onPr: () => {},
      onExit: (id, e) => spawnResolvers.get(id)?.({ exitCode: e.exitCode, prUrls: e.prUrls })
    })
    const spawnResolvers = new Map<string, (r: { exitCode: number; prUrls: string[] }) => void>()

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
```

- [ ] **Step 4: Update config.example.yaml**

Append the watch block with comments:

```yaml

# SeniorDevWatch — background tray poller (separate process: `pnpm watch`).
# watch:
#   enabled: true
#   intervalSeconds: 300          # how often to poll Jira
#   label: SeniorDev              # the trigger label
#   triggerStatusCategory: "To Do"
#   transitionOnDispatch: "In Progress"   # moved here after dispatch
#   autoMode: false               # initial default; the tray checkbox overrides at runtime
```

- [ ] **Step 5: Document SeniorDevWatch in README.md**

Add a section describing: what it does (polls `assignee = currentUser() AND labels = SeniorDev AND statusCategory = "To Do"`), how to run it (`pnpm watch`), the tray menu (Auto-dispatch toggle, Pause, Poll now, Open config, Quit), the approve-vs-auto behavior, that a failed classification is recorded and needs the key cleared from `watch-state.json` to retry, and that a ticket with no matching repo is skipped.

- [ ] **Step 6: Build to verify the second entry compiles**

Run: `pnpm typecheck && pnpm watch:build`
Expected: typecheck clean; build emits `out/main/watch.js` (and `out/main/index.js`).

- [ ] **Step 7: Manual smoke checklist**

Run: `pnpm watch` (with a valid `config.yaml`, `watch.enabled: true`, and at least one `SeniorDev`-labeled ticket assigned to you in a status-category "To Do", plus a matching repo in `repos`).

Confirm:
- [ ] Tray icon (asleep raccoon) appears; right-click shows the menu.
- [ ] "Poll now" fires; a `SeniorDev` ticket in approve mode raises a click-to-run notification; clicking it starts a run and the icon switches to the hardhat raccoon while running.
- [ ] Toggling "Auto-dispatch" persists (re-open the menu; check `watch-state.json` has `"autoMode": true`).
- [ ] After a successful run, the ticket moved to "In Progress" in Jira and re-polling does not re-dispatch it.
- [ ] A ticket whose project has no `repos` entry raises a "no repo configured" notification and is not run.

- [ ] **Step 8: Commit**

```bash
git add src/watch/main.ts electron.vite.config.ts package.json config.example.yaml README.md assets/raccoon-asleep.png assets/raccoon-hardhat.png
git commit -m "feat(watch): headless Electron tray entry, build wiring, docs, icons"
```

---

### Task 10: Full-suite regression gate

- [ ] **Step 1: Run the whole suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all green, no new failures vs. the Task 0 baseline. In particular `src/main/ipc/orchestrator-handlers.test.ts` passes unchanged.

- [ ] **Step 2: Confirm no unintended staging**

Run: `git status --short`
Expected: only the intended files committed across tasks; `package.json`/`pnpm-lock.yaml`'s electron pin remains unstaged unless Task 9 Step 2 added the scripts (in which case package.json's script diff is committed and the electron pin line is not — verify with `git diff package.json`).

---

## Notes for the implementer

- **Verify the Jira search endpoint** against the live instance early (Task 1). If `POST /rest/api/3/search/jql` behaves differently on this deployment, adjust the request shape but keep `search(jql): Promise<Ticket[]>` and its tests stable.
- **The extraction (Task 7) is the one refactor of shipped code.** Its safety net is the untouched `orchestrator-handlers.test.ts`. If a case goes red, the extraction changed behavior — fix `run.ts`, never the test.
- **autoMode precedence:** runtime (`watch-state.json`) over config default — `state.getAutoMode() ?? config.watch.autoMode`.
- **Dedup timing:** record + transition happen right after classify succeeds (before the long run) so a re-poll mid-run can't re-dispatch.
