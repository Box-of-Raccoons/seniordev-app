# SeniorDev Phase 3 — Prompts + Injection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps. Workers make file edits only; orchestrator runs all tests/typecheck/build/git.

**Goal:** Choose a prebuilt prompt (or type an ad-hoc one) when starting an interactive session; the app expands it with the ticket's content (ADF→markdown) and forge placeholders, then delivers it to the CLI (stdin paste or arg).

**Architecture:** A `prompt-library` (main) loads markdown+frontmatter templates from `promptsDir`. A pure `adfToMarkdown` (shared) plus `buildPromptTicket` turn a `Ticket` into markdown-ready fields honoring the `ticketContext` toggle. `expandPrompt` substitutes `{{ticket.*}}`/`{{forge.*}}`. The terminal spawn handler expands the prompt, builds the launch (prompt as arg for arg-delivery tools, or stdin write after boot for stdin tools), and delivers it. A new `prompts:list` IPC feeds the renderer's session menu.

**Tech Stack:** yaml (frontmatter), existing stack. No new deps.

## Global Constraints

- **pnpm**; `pnpm test`/`typecheck`/`build`. Branch `feat/phase3-prompts` off `develop`. No AI-attribution in commits.
- **Native isolation preserved:** no test-imported module imports `node-pty`.
- **Placeholders:** `{{ticket.key|type|status|summary|description|acceptanceCriteria|comments}}` and `{{forge.prCommand|term}}`. `{{ticket.key}}` is ALWAYS filled. Unknown placeholders are left verbatim.
- **ticketContext modes** (from config, default `both`): `inject`/`both` fill all ticket fields; `key-only` fills only `{{ticket.key}}` (other ticket fields → empty string).
- **Security:** markdown links must run through the same URL scheme allow-list as Phase 1 (`http/https/mailto` only) — no `javascript:`/`data:` in `[text](url)`.
- **Prompt delivery:** per `cliTools[tool].promptDelivery`: `arg` → substitute `promptArg`'s `{{prompt}}` and append to args at spawn; `stdin` → write the expanded prompt + `\r` to the PTY shortly after spawn (interactive tools boot first).
- **Interfaces from earlier phases (do not break):** `Ticket` (`src/shared/types.ts`), `Config` with `forges`, `defaultForge`, `ticketContext`, `promptsDir?`, `repos[].forge?`. `buildInteractiveLaunch(config, opts)` (session.ts) and `registerTerminalIpc(config, getSender, spawner)` (terminal-handlers.ts) currently exist — this phase extends both (additively).

## File Structure (Phase 3)

```
src/shared/adf-to-markdown.ts        (NEW: adfToMarkdown — pure)
src/main/prompts/library.ts          (NEW: loadPrompts, findPrompt, PromptTemplate)
src/main/prompts/expand.ts           (NEW: PromptTicket, buildPromptTicket, expandPrompt, resolveForge)
src/main/terminal/session.ts         (MODIFY: prompt delivery + Launch.stdinPrompt)
src/shared/ipc.ts                    (MODIFY: SpawnTerminalRequest.prompt, PROMPTS channel, PromptSummary)
src/main/ipc/terminal-handlers.ts    (MODIFY: expand+deliver; add getTicket + prompts deps)
src/main/ipc/prompts-handlers.ts     (NEW: prompts:list)
src/preload/index.ts                 (MODIFY: prompt in spawn + listPrompts)
src/main/index.ts                    (MODIFY: load prompts, pass getTicket + prompts, register prompts ipc)
src/renderer/src/components/RightPanel.vue    (MODIFY: session menu w/ prompt picker)
src/renderer/src/components/TerminalView.vue  (MODIFY: pass prompt in spawn)
src/renderer/src/components/NewSessionMenu.vue (NEW: prompt picker + ad-hoc)
```

---

### Task 1: adfToMarkdown (shared, pure)

**Files:** Create `src/shared/adf-to-markdown.ts`, `src/shared/adf-to-markdown.test.ts`

**Interfaces:** Produces `adfToMarkdown(doc: AdfNode | null): string`.

- [ ] **Step 1: Failing test** — `src/shared/adf-to-markdown.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { adfToMarkdown } from './adf-to-markdown'
import type { AdfNode } from './types'

const doc = (content: AdfNode[]): AdfNode => ({ type: 'doc', content })

describe('adfToMarkdown', () => {
  it('returns empty for null', () => {
    expect(adfToMarkdown(null)).toBe('')
  })
  it('renders paragraphs, bold, and links (safe scheme)', () => {
    const md = adfToMarkdown(doc([
      { type: 'paragraph', content: [
        { type: 'text', text: 'hi ' },
        { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
        { type: 'text', text: ' site', marks: [{ type: 'link', attrs: { href: 'https://x.io' } }] }
      ] }
    ]))
    expect(md).toBe('hi **bold** [ site](https://x.io)')
  })
  it('drops javascript: links to plain text', () => {
    const md = adfToMarkdown(doc([
      { type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }
    ]))
    expect(md).toBe('x')
    expect(md).not.toContain('javascript:')
  })
  it('renders headings, bullet lists, and code blocks', () => {
    const md = adfToMarkdown(doc([
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
      { type: 'bulletList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] }
      ] },
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const x = 1' }] }
    ]))
    expect(md).toContain('## Title')
    expect(md).toContain('- a\n- b')
    expect(md).toContain('```ts\nconst x = 1\n```')
  })
})
```

- [ ] **Step 2: Run → FAIL** — `pnpm test src/shared/adf-to-markdown.test.ts`

- [ ] **Step 3: Implement** — `src/shared/adf-to-markdown.ts`

```ts
import type { AdfNode } from './types'

function safeUrl(raw: unknown): string {
  const url = String(raw ?? '').trim()
  return /^(https?:|mailto:)/i.test(url) ? url : ''
}

function applyMarks(text: string, marks: AdfNode['marks']): string {
  let out = text
  for (const m of marks ?? []) {
    switch (m.type) {
      case 'strong': out = `**${out}**`; break
      case 'em': out = `*${out}*`; break
      case 'code': out = `\`${out}\``; break
      case 'strike': out = `~~${out}~~`; break
      case 'link': {
        const href = safeUrl(m.attrs?.href)
        out = href ? `[${out}](${href})` : out
        break
      }
    }
  }
  return out
}

function inlineToMd(nodes: AdfNode[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === 'text') return applyMarks(n.text ?? '', n.marks)
      if (n.type === 'hardBreak') return '\n'
      if (n.type === 'emoji') return String(n.attrs?.text ?? n.attrs?.shortName ?? '')
      if (n.type === 'mention') return `@${String(n.attrs?.text ?? n.attrs?.id ?? '')}`
      return inlineToMd(n.content)
    })
    .join('')
}

function nodeToMd(node: AdfNode): string {
  switch (node.type) {
    case 'paragraph': return inlineToMd(node.content)
    case 'heading': {
      const lvl = Number(node.attrs?.level)
      const level = Number.isFinite(lvl) ? Math.min(Math.max(lvl, 1), 6) : 1
      return `${'#'.repeat(level)} ${inlineToMd(node.content)}`
    }
    case 'bulletList':
      return (node.content ?? []).map((li) => `- ${inlineToMd(li.content).trim()}`).join('\n')
    case 'orderedList':
      return (node.content ?? []).map((li, i) => `${i + 1}. ${inlineToMd(li.content).trim()}`).join('\n')
    case 'blockquote':
      return blockToMd(node.content).split('\n').map((l) => `> ${l}`).join('\n')
    case 'codeBlock': {
      const lang = String(node.attrs?.language ?? '')
      return '```' + lang + '\n' + inlineToMd(node.content) + '\n```'
    }
    case 'rule': return '---'
    case 'panel': return blockToMd(node.content)
    default: return inlineToMd(node.content)
  }
}

function blockToMd(nodes: AdfNode[] | undefined): string {
  return (nodes ?? []).map(nodeToMd).join('\n\n')
}

export function adfToMarkdown(doc: AdfNode | null): string {
  if (!doc) return ''
  if (doc.type === 'doc') return blockToMd(doc.content)
  return nodeToMd(doc)
}
```

- [ ] **Step 4: Run → PASS** — `pnpm test src/shared/adf-to-markdown.test.ts` (4)

- [ ] **Step 5: Commit**

```bash
git add src/shared/adf-to-markdown.ts src/shared/adf-to-markdown.test.ts
git commit -m "feat(adf): pure ADF-to-markdown converter for prompt injection"
```

---

### Task 2: Prompt library (load + find)

**Files:** Create `src/main/prompts/library.ts`, `src/main/prompts/library.test.ts`

**Interfaces:** Produces `interface PromptTemplate { name:string; description:string; body:string }`; `loadPrompts(dir:string): PromptTemplate[]`; `findPrompt(prompts: PromptTemplate[], name:string): PromptTemplate | undefined`.

- [ ] **Step 1: Failing test** — `src/main/prompts/library.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadPrompts, findPrompt } from './library'

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'sd-prompts-'))
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content, 'utf8')
  return dir
}

describe('loadPrompts', () => {
  it('returns [] for a missing directory', () => {
    expect(loadPrompts(join(tmpdir(), 'does-not-exist-xyz'))).toEqual([])
  })
  it('loads md prompts with frontmatter', () => {
    const dir = dirWith({
      'fix-bug.md': '---\nname: fix-bug\ndescription: Fix a bug\n---\nWork {{ticket.key}}.',
      'notes.txt': 'ignored'
    })
    const prompts = loadPrompts(dir)
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toEqual({ name: 'fix-bug', description: 'Fix a bug', body: 'Work {{ticket.key}}.' })
  })
  it('falls back to the filename when frontmatter has no name', () => {
    const dir = dirWith({ 'plain.md': 'just a body' })
    expect(loadPrompts(dir)[0]).toEqual({ name: 'plain', description: '', body: 'just a body' })
  })
})

describe('findPrompt', () => {
  it('finds by name or returns undefined', () => {
    const prompts = [{ name: 'a', description: '', body: 'x' }]
    expect(findPrompt(prompts, 'a')?.body).toBe('x')
    expect(findPrompt(prompts, 'z')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement** — `src/main/prompts/library.ts`

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'

export interface PromptTemplate {
  name: string
  description: string
  body: string
}

function parseFrontmatter(raw: string, fallbackName: string): PromptTemplate {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { name: fallbackName, description: '', body: raw.trim() }
  const fm = (parse(m[1]) ?? {}) as Record<string, unknown>
  return {
    name: typeof fm.name === 'string' ? fm.name : fallbackName,
    description: typeof fm.description === 'string' ? fm.description : '',
    body: m[2].trim()
  }
}

export function loadPrompts(dir: string): PromptTemplate[] {
  if (!dir || !existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.md'))
    .map((f) => parseFrontmatter(readFileSync(join(dir, f), 'utf8'), f.replace(/\.md$/i, '')))
}

export function findPrompt(prompts: PromptTemplate[], name: string): PromptTemplate | undefined {
  return prompts.find((p) => p.name === name)
}
```

- [ ] **Step 4: Run → PASS** (5)

- [ ] **Step 5: Commit**

```bash
git add src/main/prompts/library.ts src/main/prompts/library.test.ts
git commit -m "feat(prompts): markdown+frontmatter prompt library loader"
```

---

### Task 3: Prompt context + expansion

**Files:** Create `src/main/prompts/expand.ts`, `src/main/prompts/expand.test.ts`

**Interfaces:**
- Consumes `adfToMarkdown` (Task 1), `Ticket`, `Config`.
- Produces:
  - `interface PromptTicket { key:string; type:string; status:string; summary:string; descriptionMd:string; acceptanceCriteria:string; commentsMd:string }`
  - `buildPromptTicket(ticket: Ticket, mode: 'inject'|'key-only'|'both'): PromptTicket`
  - `resolveForge(config: Config, ticketKey?: string): { prCommand: string; term: string }`
  - `expandPrompt(body: string, ctx: { ticket: PromptTicket; forge: { prCommand:string; term:string } }): string`

- [ ] **Step 1: Failing test** — `src/main/prompts/expand.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { buildPromptTicket, expandPrompt, resolveForge } from './expand'
import type { Ticket } from '../../shared/types'
import type { Config } from '../config/schema'

const ticket: Ticket = {
  key: 'PROJ-1', type: 'Bug', status: 'Open', summary: 'Login broken',
  descriptionAdf: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'It fails.' }] }] },
  acceptanceCriteria: null,
  comments: [{ author: 'Jane', createdIso: '', bodyAdf: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'seen it' }] }] } }],
  url: 'https://x/browse/PROJ-1'
}

describe('buildPromptTicket', () => {
  it('fills markdown fields in inject mode', () => {
    const pt = buildPromptTicket(ticket, 'inject')
    expect(pt.key).toBe('PROJ-1')
    expect(pt.summary).toBe('Login broken')
    expect(pt.descriptionMd).toBe('It fails.')
    expect(pt.commentsMd).toContain('**Jane**')
    expect(pt.acceptanceCriteria).toBe('')
  })
  it('fills only the key in key-only mode', () => {
    const pt = buildPromptTicket(ticket, 'key-only')
    expect(pt.key).toBe('PROJ-1')
    expect(pt.summary).toBe('')
    expect(pt.descriptionMd).toBe('')
    expect(pt.commentsMd).toBe('')
  })
})

describe('resolveForge', () => {
  const cfg = {
    defaultForge: 'github',
    forges: {
      github: { prCommand: 'gh pr create', term: 'PR', urlPattern: 'x' },
      gitlab: { prCommand: 'glab mr create', term: 'MR', urlPattern: 'y' }
    },
    repos: [{ key: 'PROJ', path: '/p', branchPrefix: '', forge: 'gitlab' }]
  } as unknown as Config
  it('uses the mapped repo forge', () => {
    expect(resolveForge(cfg, 'PROJ-2').term).toBe('MR')
  })
  it('falls back to defaultForge', () => {
    expect(resolveForge(cfg, 'OTHER-1').prCommand).toBe('gh pr create')
    expect(resolveForge(cfg).prCommand).toBe('gh pr create')
  })
})

describe('expandPrompt', () => {
  const pt = buildPromptTicket(ticket, 'inject')
  const forge = { prCommand: 'gh pr create', term: 'PR' }
  it('substitutes ticket and forge placeholders', () => {
    const out = expandPrompt('Do {{ticket.key}}: "{{ticket.summary}}". Open a {{forge.term}} with `{{forge.prCommand}}`.', { ticket: pt, forge })
    expect(out).toBe('Do PROJ-1: "Login broken". Open a PR with `gh pr create`.')
  })
  it('leaves unknown placeholders untouched', () => {
    expect(expandPrompt('keep {{weird.thing}}', { ticket: pt, forge })).toBe('keep {{weird.thing}}')
  })
})
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement** — `src/main/prompts/expand.ts`

```ts
import type { Ticket } from '../../shared/types'
import type { Config } from '../config/schema'
import { adfToMarkdown } from '../../shared/adf-to-markdown'

export interface PromptTicket {
  key: string
  type: string
  status: string
  summary: string
  descriptionMd: string
  acceptanceCriteria: string
  commentsMd: string
}

const EMPTY = { type: '', status: '', summary: '', descriptionMd: '', acceptanceCriteria: '', commentsMd: '' }

export function buildPromptTicket(ticket: Ticket, mode: 'inject' | 'key-only' | 'both'): PromptTicket {
  if (mode === 'key-only') return { key: ticket.key, ...EMPTY }
  const commentsMd = ticket.comments
    .map((c) => `**${c.author}**: ${adfToMarkdown(c.bodyAdf)}`)
    .join('\n\n')
  return {
    key: ticket.key,
    type: ticket.type,
    status: ticket.status,
    summary: ticket.summary,
    descriptionMd: adfToMarkdown(ticket.descriptionAdf),
    acceptanceCriteria: ticket.acceptanceCriteria ?? '',
    commentsMd
  }
}

export function resolveForge(config: Config, ticketKey?: string): { prCommand: string; term: string } {
  let forgeName = config.defaultForge
  if (ticketKey) {
    const project = ticketKey.split('-')[0].toUpperCase()
    const repo = config.repos.find((r) => r.key.toUpperCase() === project)
    if (repo?.forge) forgeName = repo.forge
  }
  const forge = config.forges[forgeName] ?? config.forges[config.defaultForge]
  return { prCommand: forge?.prCommand ?? '', term: forge?.term ?? 'PR' }
}

export function expandPrompt(
  body: string,
  ctx: { ticket: PromptTicket; forge: { prCommand: string; term: string } }
): string {
  const map: Record<string, string> = {
    'ticket.key': ctx.ticket.key,
    'ticket.type': ctx.ticket.type,
    'ticket.status': ctx.ticket.status,
    'ticket.summary': ctx.ticket.summary,
    'ticket.description': ctx.ticket.descriptionMd,
    'ticket.acceptanceCriteria': ctx.ticket.acceptanceCriteria,
    'ticket.comments': ctx.ticket.commentsMd,
    'forge.prCommand': ctx.forge.prCommand,
    'forge.term': ctx.forge.term
  }
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, key: string) => (key in map ? map[key] : m))
}
```

- [ ] **Step 4: Run → PASS** (6)

- [ ] **Step 5: Commit**

```bash
git add src/main/prompts/expand.ts src/main/prompts/expand.test.ts
git commit -m "feat(prompts): ticket->markdown context + placeholder expansion + forge resolve"
```

---

### Task 4: Prompt delivery — session launch, terminal handler, prompts IPC, wiring

**Files:**
- Modify: `src/main/terminal/session.ts`, `src/shared/ipc.ts`, `src/main/ipc/terminal-handlers.ts`, `src/preload/index.ts`, `src/main/index.ts`
- Create: `src/main/ipc/prompts-handlers.ts`
- Test: `src/main/terminal/session.test.ts` (extend), `src/main/ipc/prompts-handlers.test.ts`

**Interfaces:**
- `Launch` gains `stdinPrompt?: string`. `buildInteractiveLaunch(config, opts, expandedPrompt?)` — for `arg` tools with a prompt, appends the `promptArg` (with `{{prompt}}` replaced); for `stdin` tools with a prompt, sets `stdinPrompt`.
- `SpawnTerminalRequest` gains `prompt?: { name?: string; text?: string }`.
- `registerTerminalIpc(config, getSender, spawner, deps)` where `deps = { getTicket: (key:string)=>Promise<Ticket>; prompts: PromptTemplate[] }`.
- `registerPromptsIpc(prompts): void` registers `PROMPTS.list` returning `PromptSummary[]` (`{name,description}`).
- `window.api.listPrompts(): Promise<PromptSummary[]>`; `spawnTerminal` request carries `prompt`.

- [ ] **Step 1: Extend `src/main/terminal/session.ts`** — replace the file:

```ts
import type { Config } from '../config/schema'
import { resolveCwd } from './resolve'

export interface Launch {
  file: string
  args: string[]
  cwd: string
  stdinPrompt?: string
}

export function buildInteractiveLaunch(
  config: Config,
  opts: { tool?: string; ticketKey?: string; cwdOverride?: string },
  expandedPrompt?: string
): Launch {
  const toolName = opts.tool ?? config.defaultTool
  const tool = config.cliTools[toolName]
  if (!tool) throw new Error(`Unknown CLI tool: ${toolName}`)
  const cwd = resolveCwd(config, opts.ticketKey, opts.cwdOverride)
  const args = [...tool.interactiveArgs]

  if (expandedPrompt && tool.promptDelivery === 'arg') {
    const template = tool.promptArg ?? '{{prompt}}'
    args.push(template.replace('{{prompt}}', expandedPrompt))
    return { file: tool.command, args, cwd }
  }
  return {
    file: tool.command,
    args,
    cwd,
    stdinPrompt: expandedPrompt && tool.promptDelivery === 'stdin' ? expandedPrompt : undefined
  }
}
```

- [ ] **Step 2: Extend the session test** — append inside `describe('buildInteractiveLaunch', …)` in `src/main/terminal/session.test.ts`:

```ts
  it('appends an arg-delivery prompt to args', () => {
    const l = buildInteractiveLaunch(cfg, { tool: 'codex' }, 'DO THIS')
    expect(l.args).toEqual(['--foo', 'DO THIS'])
    expect(l.stdinPrompt).toBeUndefined()
  })
  it('sets stdinPrompt for a stdin-delivery tool', () => {
    const l = buildInteractiveLaunch(cfg, { tool: 'claude' }, 'DO THIS')
    expect(l.args).toEqual([])
    expect(l.stdinPrompt).toBe('DO THIS')
  })
```
(The Phase-2 `cfg` in that file already defines `claude` promptDelivery `stdin` and `codex` promptDelivery `arg` with `promptArg: '{{prompt}}'`; do not change it.)

- [ ] **Step 3: Run → the two new cases PASS** — `pnpm test src/main/terminal/session.test.ts` (5)

- [ ] **Step 4: Extend `src/shared/ipc.ts`** — modify `SpawnTerminalRequest` to add `prompt`, and append prompts channel + summary type:

Change the `SpawnTerminalRequest` interface to include:
```ts
  prompt?: { name?: string; text?: string }
```
Then append:
```ts
export interface PromptSummary { name: string; description: string }
export const PROMPTS = { list: 'prompts:list' } as const
```

- [ ] **Step 5: Write `src/main/ipc/prompts-handlers.ts`**

```ts
import { ipcMain } from 'electron'
import type { PromptTemplate } from '../prompts/library'
import { PROMPTS, type PromptSummary } from '../../shared/ipc'

export function registerPromptsIpc(prompts: PromptTemplate[]): void {
  ipcMain.handle(PROMPTS.list, (): PromptSummary[] =>
    prompts.map((p) => ({ name: p.name, description: p.description }))
  )
}
```

- [ ] **Step 6: Write its test** — `src/main/ipc/prompts-handlers.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const handleMap = new Map<string, (...a: unknown[]) => unknown>()
vi.mock('electron', () => ({ ipcMain: { handle: (c: string, f: (...a: unknown[]) => unknown) => handleMap.set(c, f) } }))

import { registerPromptsIpc } from './prompts-handlers'

beforeEach(() => handleMap.clear())

describe('registerPromptsIpc', () => {
  it('returns name+description summaries (not bodies)', async () => {
    registerPromptsIpc([{ name: 'fix', description: 'Fix it', body: 'SECRET BODY' }])
    const res = await handleMap.get('prompts:list')!()
    expect(res).toEqual([{ name: 'fix', description: 'Fix it' }])
  })
})
```

- [ ] **Step 7: Update terminal handler** — replace `src/main/ipc/terminal-handlers.ts`

```ts
import { ipcMain } from 'electron'
import type { Config } from '../config/schema'
import type { Ticket } from '../../shared/types'
import { TerminalManager, type PtySpawner } from '../terminal/manager'
import { buildInteractiveLaunch } from '../terminal/session'
import { TERM, type SpawnTerminalRequest, type SpawnResult } from '../../shared/ipc'
import { type PromptTemplate, findPrompt } from '../prompts/library'
import { buildPromptTicket, expandPrompt, resolveForge } from '../prompts/expand'

export interface TerminalDeps {
  getTicket: (key: string) => Promise<Ticket>
  prompts: PromptTemplate[]
}

// Interactive CLIs need a moment to boot before they accept typed input.
const STDIN_PROMPT_DELAY_MS = 800

async function resolveExpandedPrompt(
  config: Config,
  deps: TerminalDeps,
  req: SpawnTerminalRequest
): Promise<string | undefined> {
  if (!req.prompt) return undefined
  let body = req.prompt.text
  if (req.prompt.name) {
    const tmpl = findPrompt(deps.prompts, req.prompt.name)
    if (!tmpl) throw new Error(`Unknown prompt: ${req.prompt.name}`)
    body = tmpl.body
  }
  if (body === undefined) return undefined

  const mode = config.ticketContext
  let ticketCtx = buildPromptTicket(
    { key: req.ticketKey ?? '', type: '', status: '', summary: '', descriptionAdf: null, acceptanceCriteria: null, comments: [], url: '' },
    mode
  )
  if (req.ticketKey) {
    const ticket = await deps.getTicket(req.ticketKey)
    ticketCtx = buildPromptTicket(ticket, mode)
  }
  const forge = resolveForge(config, req.ticketKey)
  return expandPrompt(body, { ticket: ticketCtx, forge })
}

export function registerTerminalIpc(
  config: Config,
  getSender: () => Electron.WebContents | undefined,
  spawner: PtySpawner,
  deps: TerminalDeps
): TerminalManager {
  const manager = new TerminalManager(spawner, {
    onData: (id, data) => getSender()?.send(TERM.data, { id, data }),
    onExit: (id, exitCode) => getSender()?.send(TERM.exit, { id, exitCode })
  })

  ipcMain.handle(TERM.spawn, async (_e, req: SpawnTerminalRequest): Promise<SpawnResult> => {
    try {
      const expanded = await resolveExpandedPrompt(config, deps, req)
      const launch = buildInteractiveLaunch(config, req, expanded)
      manager.spawn(req.id, { file: launch.file, args: launch.args, cwd: launch.cwd, cols: req.cols, rows: req.rows })
      if (launch.stdinPrompt) {
        const prompt = launch.stdinPrompt
        setTimeout(() => manager.write(req.id, prompt + '\r'), STDIN_PROMPT_DELAY_MS)
      }
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

- [ ] **Step 8: Extend the terminal-handler test** — add a case to `src/main/ipc/terminal-handlers.test.ts`. First, every existing `registerTerminalIpc(...)` call in that file gains a 4th arg `{ getTicket: async () => ticket, prompts: [] }`. Add this ticket fixture near the top (after imports):

```ts
import type { Ticket } from '../../shared/types'
const ticket: Ticket = { key: 'PROJ-1', type: 'Bug', status: 'Open', summary: 's', descriptionAdf: null, acceptanceCriteria: null, comments: [], url: 'u' }
const deps = { getTicket: async () => ticket, prompts: [{ name: 'p', description: '', body: 'Do {{ticket.key}}' }] }
```
Update the three existing calls to pass `deps` as the 4th argument. Then add:

```ts
  it('expands a named prompt and writes it to stdin after the boot delay', async () => {
    vi.useFakeTimers()
    const pty = fakePty()
    registerTerminalIpc(cfg, () => undefined, () => pty as unknown as PtyProcess, deps)
    const res = await handleMap.get('pty:spawn')!({}, { id: 'a', ticketKey: 'PROJ-1', prompt: { name: 'p' }, cols: 80, rows: 24 })
    expect(res).toEqual({ ok: true })
    await vi.runAllTimersAsync()
    expect(pty.write).toHaveBeenCalledWith('Do PROJ-1\r')
    vi.useRealTimers()
  })
```
(`cfg` in that file has `claude` as default with `promptDelivery: 'stdin'`, so the prompt goes to stdin.)

- [ ] **Step 9: Run → PASS** — `pnpm test src/main/ipc/terminal-handlers.test.ts` (4) and `src/main/ipc/prompts-handlers.test.ts` (1)

- [ ] **Step 10: Extend preload** — in `src/preload/index.ts`, add to the `api` object:

```ts
  listPrompts: (): Promise<import('../shared/ipc').PromptSummary[]> => ipcRenderer.invoke(PROMPTS.list),
```
and add `PROMPTS` to the existing `import { IPC, TERM, ... } from '../shared/ipc'` line. (`spawnTerminal` already forwards the whole request object, so the new `prompt` field flows through with no change.)

- [ ] **Step 11: Wire main** — in `src/main/index.ts`: load prompts and pass deps. Add imports:
```ts
import { loadPrompts } from './prompts/library'
import { registerPromptsIpc } from './ipc/prompts-handlers'
import { homedir } from 'node:os'
```
Add a prompts-dir resolver near `resolveConfigPath`:
```ts
function resolvePromptsDir(cfg: Config): string {
  return cfg.promptsDir ?? join(homedir(), '.config', 'SeniorDev', 'prompts')
}
```
In `app.whenReady()`, where terminals are registered, change to build a `getTicket` reused by both handlers and load prompts:
```ts
  registerIpc(buildGetTicket())
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
```
(Keep the CSP block, `registerIpc(buildGetTicket())`, and quit handlers. `buildGetTicket` still sets `loadedConfig`; the new `JiraClient` here is a second lightweight instance used for injection — acceptable, or refactor to reuse; either is fine.)

- [ ] **Step 12: Typecheck + build** — `pnpm typecheck` clean; `pnpm build` bundles.

- [ ] **Step 13: Commit**

```bash
git add src/main/terminal/session.ts src/main/terminal/session.test.ts src/shared/ipc.ts src/main/ipc/terminal-handlers.ts src/main/ipc/terminal-handlers.test.ts src/main/ipc/prompts-handlers.ts src/main/ipc/prompts-handlers.test.ts src/preload/index.ts src/main/index.ts
git commit -m "feat(prompts): expand + deliver prompts on session spawn, prompts:list ipc"
```

---

### Task 5: Renderer — New session menu with prompt picker (design task)

**Files:**
- Create: `src/renderer/src/components/NewSessionMenu.vue`
- Modify: `src/renderer/src/components/RightPanel.vue`, `src/renderer/src/components/TerminalView.vue`
- Test: `src/renderer/src/components/RightPanel.test.ts` (extend)

**Interfaces:**
- `NewSessionMenu` fetches `window.api.listPrompts()`, shows: "Interactive (no prompt)", each prompt (name + description), and "Custom prompt…" (textarea). Emits `start` with `{ prompt?: { name?: string; text?: string } }`.
- `RightPanel` opens a session with the chosen prompt; passes `:prompt` to `TerminalView`.
- `TerminalView` includes `prompt` in its `spawnTerminal` request.

- [ ] **Step 1: Write `NewSessionMenu.vue`** — `src/renderer/src/components/NewSessionMenu.vue`

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { PromptSummary } from '../../../shared/ipc'

const emit = defineEmits<{ (e: 'start', payload: { prompt?: { name?: string; text?: string } }): void }>()

const open = ref(false)
const prompts = ref<PromptSummary[]>([])
const customOpen = ref(false)
const customText = ref('')

onMounted(async () => {
  try { prompts.value = await window.api.listPrompts() } catch { prompts.value = [] }
})

function choose(payload: { prompt?: { name?: string; text?: string } }): void {
  open.value = false
  customOpen.value = false
  customText.value = ''
  emit('start', payload)
}
</script>

<template>
  <div class="menu-wrap">
    <button class="new-session" @click="open = !open">+ New session ▾</button>
    <div v-if="open" class="menu">
      <button class="menu-item" @click="choose({})">Interactive (no prompt)</button>
      <button
        v-for="p in prompts"
        :key="p.name"
        class="menu-item"
        @click="choose({ prompt: { name: p.name } })"
      >
        <span class="menu-item__name">{{ p.name }}</span>
        <span v-if="p.description" class="menu-item__desc">{{ p.description }}</span>
      </button>
      <button class="menu-item" @click="customOpen = !customOpen">Custom prompt…</button>
      <form v-if="customOpen" class="custom" @submit.prevent="choose({ prompt: { text: customText } })">
        <textarea v-model="customText" rows="3" placeholder="Type a first prompt…"></textarea>
        <button class="custom__go" type="submit" :disabled="!customText.trim()">Start</button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.menu-wrap { position: relative; }
.new-session {
  background: var(--teal); color: var(--bg); border: 0;
  border-radius: var(--radius-sm); padding: 6px 12px; cursor: pointer; font-weight: 600; white-space: nowrap;
}
.new-session:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.menu {
  position: absolute; right: 0; top: calc(100% + 4px); z-index: 20;
  min-width: 240px; background: var(--surface-2); border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-sm); padding: 4px; display: flex; flex-direction: column; gap: 2px;
  box-shadow: 0 10px 30px oklch(0 0 0 / 0.35);
}
.menu-item {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  background: transparent; color: var(--ink); border: 0; border-radius: var(--radius-sm);
  padding: 7px 10px; cursor: pointer; text-align: left; width: 100%;
}
.menu-item:hover { background: var(--surface); }
.menu-item__desc { color: var(--ink-muted); font-size: 12px; }
.custom { display: flex; flex-direction: column; gap: 6px; padding: 6px; }
.custom textarea {
  background: var(--surface); color: var(--ink); border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-sm); padding: 6px; resize: vertical; font-family: inherit;
}
.custom__go {
  align-self: flex-end; background: var(--teal); color: var(--bg); border: 0;
  border-radius: var(--radius-sm); padding: 5px 12px; cursor: pointer; font-weight: 600;
}
.custom__go:disabled { opacity: 0.5; cursor: default; }
</style>
```

- [ ] **Step 2: Update `RightPanel.vue`** — replace its `<script setup>` and the tab-bar button, keeping styles:

Replace the `newSession` function and the `interface Term`/`terms` typing to carry a prompt, and swap the plain button for `NewSessionMenu`. New `<script setup>`:

```ts
import { ref } from 'vue'
import TerminalView from './TerminalView.vue'
import NewSessionMenu from './NewSessionMenu.vue'

defineProps<{ activeTicketKey: string | null }>()

interface Term { id: string; title: string; prompt?: { name?: string; text?: string } }
const terms = ref<Term[]>([])
const activeId = ref<string | null>(null)
let counter = 0

function startSession(payload: { prompt?: { name?: string; text?: string } }): void {
  counter += 1
  const id = `t${counter}-${Date.now()}`
  const title = payload.prompt?.name ? `${payload.prompt.name} ${counter}` : `Session ${counter}`
  terms.value.push({ id, title, prompt: payload.prompt })
  activeId.value = id
}

function closeTerm(id: string): void {
  const i = terms.value.findIndex((t) => t.id === id)
  if (i === -1) return
  terms.value.splice(i, 1)
  if (activeId.value === id) activeId.value = terms.value.at(-1)?.id ?? null
}
```

In the template, replace `<button class="new-session" @click="newSession">+ New session</button>` with:
```html
<NewSessionMenu @start="startSession" />
```
and pass the prompt to the TerminalView:
```html
<TerminalView :id="t.id" :ticket-key="activeTicketKey" :prompt="t.prompt" />
```
Remove the now-unused `.new-session` style block from RightPanel (it moved to NewSessionMenu).

- [ ] **Step 3: Update `TerminalView.vue`** — add a `prompt` prop and include it in the spawn:

Change `defineProps` to:
```ts
const props = defineProps<{ id: string; ticketKey: string | null; prompt?: { name?: string; text?: string } }>()
```
and in the `spawnTerminal` call add `prompt: props.prompt,` alongside `id`/`ticketKey`/`cols`/`rows`.

- [ ] **Step 4: Extend RightPanel test** — `src/renderer/src/components/RightPanel.test.ts`: add `listPrompts: vi.fn(async () => [])` to the `window.api` mock; keep the `TerminalView` stub and add a `NewSessionMenu` stub that emits `start`:

Replace the `stubs` const with:
```ts
const stubs = {
  TerminalView: { props: ['id', 'ticketKey', 'prompt'], template: '<div class="tv" :data-id="id" />' },
  NewSessionMenu: { template: '<button class="new-session" @click="$emit(\'start\', {})" />' }
}
```
The existing three tests keep working (clicking `.new-session` now emits `start` → opens a tab). Add:
```ts
  it('titles a prompt session by the prompt name', async () => {
    const w = mount(RightPanel, { props: { activeTicketKey: null }, global: { stubs: {
      TerminalView: stubs.TerminalView,
      NewSessionMenu: { template: '<button class="np" @click="$emit(\'start\', { prompt: { name: \'fix-bug\' } })" />' }
    } } })
    await w.find('.np').trigger('click')
    expect(w.text()).toContain('fix-bug')
  })
```

- [ ] **Step 5: Run → PASS** — `pnpm test src/renderer/src/components/RightPanel.test.ts` (4)

- [ ] **Step 6: Full gate** — `pnpm test` (all), `pnpm typecheck`, `pnpm build`. Report vs baseline.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/NewSessionMenu.vue src/renderer/src/components/RightPanel.vue src/renderer/src/components/TerminalView.vue src/renderer/src/components/RightPanel.test.ts
git commit -m "feat(ui): New session menu with prebuilt + custom prompt picker"
```

---

## Self-Review

**Spec coverage (Phase 3):** prompt-library load + placeholders (Tasks 2,3) ✓; ADF→markdown second output (Task 1) ✓; ticketContext toggle inject/key-only/both (Task 3) ✓; prompt delivery stdin/arg (Task 4) ✓; New session menu Interactive/prebuilt/custom (Task 5) ✓; forge placeholders + repo-forge resolution (Task 3) ✓. Deferred: YOLO/bypass + PR detection (Phase 4); acceptanceCriteria custom-field extraction (expands to '' until a field id is configured — noted).

**Placeholder scan:** complete code in every step; commands have expected outcomes.

**Type consistency:** `PromptTemplate` (Task 2) used by Task 4. `PromptTicket`/`buildPromptTicket`/`expandPrompt`/`resolveForge` (Task 3) used by Task 4 handler. `Launch.stdinPrompt` + `buildInteractiveLaunch(…, expandedPrompt?)` (Task 4 Step 1) consumed in the same task's handler. `SpawnTerminalRequest.prompt` (Task 4 Step 4) set by TerminalView (Task 5) and read by the handler (Task 4). `PromptSummary`/`PROMPTS` (Task 4) used by prompts handler, preload, and NewSessionMenu (Task 5). `registerTerminalIpc(config, getSender, spawner, deps)` 4-arg form (Task 4 Step 7) matches its Task-4 wiring in main (Step 11) and its test updates (Step 8).

**Native isolation:** unchanged — no new `node-pty` importers; new prompt modules are pure/Node-fs only.
