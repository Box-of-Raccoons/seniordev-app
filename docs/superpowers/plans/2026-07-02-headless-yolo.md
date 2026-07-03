# Headless YOLO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the PTY-based YOLO mode with a headless child-process runner that streams a live parsed log to a new tab view, collects every PR URL, and offers a "Resume YOLO Session?" button that reopens the session interactively.

**Architecture:** A new `src/main/headless/` module spawns the CLI via `child_process.spawn` (never a PTY), pipes the expanded prompt + recap over stdin, and runs stdout through a per-tool stream parser (`claude-stream-json` | `codex-jsonl` | `text`) that emits log lines and the session id. New `YOLO.*` IPC channels feed a `YoloView.vue` log tab; resume rides the existing interactive spawn path with a `resumeArgs` template. The old PTY-YOLO path (yolo flag, `yoloArgs`, per-terminal PrDetector) is deleted.

**Tech Stack:** Electron (main/preload/renderer), Vue 3, TypeScript, Zod, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-02-headless-yolo-design.md`. One deliberate deviation, amended into the spec in Task 12: `ParsedEvent` has two kinds (`log`, `session`) — the spec's third `result` kind was dead weight (the recap already arrives as the final assistant log text).

## Verified ground truth (do NOT re-derive)

- claude 2.1.191 (installed, verified by live run): `'prompt text' | claude -p --output-format stream-json --verbose --permission-mode auto` reads the prompt from stdin and emits JSONL: `{"type":"system","subtype":"init","session_id":"…","cwd":"…"}` first, `{"type":"assistant","message":{"content":[{"type":"text","text":"…"}|{"type":"tool_use","name":"…","input":{…}}]}}` per turn, `{"type":"result","subtype":"success","is_error":false,…}` last. Hook noise (`system/hook_started`, `system/hook_response`, `rate_limit_event`) also appears and must be skipped. Resume: `claude --resume <session-id>` (verified in `--help`).
- codex (NOT installed locally; verified against https://developers.openai.com/codex/cli/reference and /codex/noninteractive on 2026-07-02): headless = `codex exec --json --dangerously-bypass-approvals-and-sandbox -` (`-` = read prompt from stdin). JSONL events: `{"type":"thread.started","thread_id":"…"}` (thread_id is the resumable id), `{"type":"item.started","item":{"type":"command_execution","command":"…"}}`, `{"type":"item.completed","item":{"type":"agent_message","text":"…"}}`, `turn.started`/`turn.completed`/`turn.failed`/`error`. Resume interactive: `codex resume <SESSION_ID>` (positional). Install for manual verification: `npm install -g @openai/codex`.

## Global Constraints

- Branch: all work on `feature/headless-yolo` in `C:\Users\hardy\code\seniordev-app`. Verify with `git -C C:\Users\hardy\code\seniordev-app branch --show-current` before every commit.
- Commit messages: NO `Co-Authored-By` or any AI-attribution trailer.
- Gates: `pnpm typecheck` and `pnpm test` (vitest run) must pass at the end of every task.
- The prompt text must NEVER appear in argv — headless delivery is stdin-only (Windows `cmd /c` shim re-parse injection, see `src/main/terminal/spawn-command.ts` header comment).
- The interactive stdin-readiness prompt-delivery machinery in `terminal-handlers.ts` (QUIET_MS/deliverPromptWhenReady) MUST survive untouched — it is how interactive sessions get their first prompt.
- `package.json` / `pnpm-lock.yaml` / `jira-check.mjs` have unrelated uncommitted changes — never stage them.
- TDD: write the failing test first in every task.

---

### Task 0: Record baseline

- [ ] **Step 1: Capture the starting gate numbers**

Run: `cd C:\Users\hardy\code\seniordev-app && pnpm typecheck && pnpm test`
Record: exact pass/fail counts and names of any failing tests. All later "no regressions" claims diff against this.

---

### Task 1: Config schema + presets (additive)

`yoloArgs` stays for now (session.ts still reads it); it dies in Task 9.

**Files:**
- Modify: `src/main/config/schema.ts`
- Modify: `src/main/config/presets.ts`
- Test: `src/main/config/schema.test.ts` (create if absent), `src/main/config/load.test.ts`

**Interfaces (produces):**
- `HeadlessSchema` → `{ args: string[]; outputParser: 'claude-stream-json'|'codex-jsonl'|'text'; sessionIdPattern?: string }`
- `CliToolSchema` gains `headless?: Headless`, `resumeArgs?: string[]`
- `ConfigSchema` gains `yoloRecap?: string`
- `presets.ts` exports `DEFAULT_YOLO_RECAP: string`

- [ ] **Step 1: Write failing tests**

```ts
// src/main/config/schema.test.ts (add; create file with these if it doesn't exist)
import { describe, expect, it } from 'vitest'
import { CliToolSchema, ConfigSchema } from './schema'

describe('headless config', () => {
  it('parses a headless block with defaults', () => {
    const t = CliToolSchema.parse({ command: 'x', headless: { args: ['-p'] } })
    expect(t.headless?.outputParser).toBe('text')
    expect(t.headless?.args).toEqual(['-p'])
  })
  it('rejects an unknown outputParser', () => {
    expect(() => CliToolSchema.parse({ command: 'x', headless: { outputParser: 'nope' } })).toThrow()
  })
  it('accepts resumeArgs and yoloRecap', () => {
    const t = CliToolSchema.parse({ command: 'x', resumeArgs: ['--resume', '{{sessionId}}'] })
    expect(t.resumeArgs).toEqual(['--resume', '{{sessionId}}'])
    const c = ConfigSchema.parse({ jira: { baseUrl: 'https://x.atlassian.net', email: 'a@b.co', apiToken: 't' }, yoloRecap: 'recap' })
    expect(c.yoloRecap).toBe('recap')
  })
  it('still accepts configs carrying legacy yoloArgs', () => {
    const t = CliToolSchema.parse({ command: 'x', yoloArgs: ['--old'] })
    expect(t.command).toBe('x')
  })
})
```

- [ ] **Step 2: Run to verify failure** — `pnpm test -- schema` → FAIL (headless unknown key stripped / outputParser undefined).

- [ ] **Step 3: Implement**

In `src/main/config/schema.ts`, above `CliToolSchema`:

```ts
export const HeadlessSchema = z.object({
  args: z.array(z.string()).default([]),
  outputParser: z.enum(['claude-stream-json', 'codex-jsonl', 'text']).default('text'),
  sessionIdPattern: z.string().optional()
})
```

Add to `CliToolSchema` (keep `yoloArgs` for now):

```ts
  headless: HeadlessSchema.optional(),
  resumeArgs: z.array(z.string()).optional()
```

Add to `ConfigSchema`:

```ts
  yoloRecap: z.string().optional()
```

In `src/main/config/presets.ts`, extend both presets and add the default recap:

```ts
export const CLI_PRESETS = {
  claude: {
    command: 'claude',
    interactiveArgs: [],
    // Legacy PTY-YOLO args — removed in the headless-YOLO cleanup task.
    yoloArgs: ['--permission-mode', 'auto'],
    promptDelivery: 'stdin',
    headless: {
      // Verified against claude 2.1.191: stdin prompt + stream-json output;
      // session_id arrives in the system/init event.
      args: ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'auto'],
      outputParser: 'claude-stream-json'
    },
    resumeArgs: ['--resume', '{{sessionId}}']
  },
  codex: {
    command: 'codex',
    interactiveArgs: [],
    yoloArgs: ['--yolo'],
    promptDelivery: 'arg',
    promptArg: '{{prompt}}',
    headless: {
      // '-' = read the prompt from stdin (developers.openai.com/codex/noninteractive).
      args: ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '-'],
      outputParser: 'codex-jsonl'
    },
    resumeArgs: ['resume', '{{sessionId}}']
  }
} as const

export const DEFAULT_YOLO_RECAP = `When you are completely finished, end your final message with:
1. "## Changes made" — every file you changed and a one-line why.
2. "## Pull requests" — the URL of each PR/MR you created (one per project if this repo is a monorepo).`
```

Note: `loadConfig`'s `mergeByKey` merges per tool-level field, so a user overriding `cliTools.claude.headless` replaces the whole `headless` object — acceptable and matches existing behavior for nested objects.

- [ ] **Step 4: Run tests** — `pnpm test -- schema && pnpm test -- load` → PASS (existing load tests unaffected; if a load test asserts the exact preset field set, extend its expectation to include `headless`/`resumeArgs`).
- [ ] **Step 5: Gate + commit**

```bash
pnpm typecheck && pnpm test
git add src/main/config/schema.ts src/main/config/presets.ts src/main/config/schema.test.ts src/main/config/load.test.ts
git commit -m "feat(config): headless + resume tool config, yoloRecap"
```

---

### Task 2: Parser core + text parser

**Files:**
- Create: `src/main/headless/parser.ts`
- Create: `src/main/headless/parsers/text.ts`
- Test: `src/main/headless/parser.test.ts`, `src/main/headless/parsers/text.test.ts`

**Interfaces (produces):**
- `type ParsedEvent = { kind: 'log'; text: string } | { kind: 'session'; id: string }`
- `interface StreamParser { feed(chunk: string): ParsedEvent[]; flush(): ParsedEvent[] }`
- `class LineBuffer { push(chunk: string): string[]; flush(): string[] }`
- `class TextParser implements StreamParser` — `new TextParser(sessionIdPattern?: string)`

- [ ] **Step 1: Write failing tests**

```ts
// src/main/headless/parser.test.ts
import { describe, expect, it } from 'vitest'
import { LineBuffer } from './parser'

describe('LineBuffer', () => {
  it('splits complete lines and buffers the partial tail', () => {
    const b = new LineBuffer()
    expect(b.push('one\ntwo\npar')).toEqual(['one', 'two'])
    expect(b.push('tial\n')).toEqual(['partial'])
  })
  it('handles CRLF', () => {
    const b = new LineBuffer()
    expect(b.push('a\r\nb\r\n')).toEqual(['a', 'b'])
  })
  it('flush returns the remaining tail once', () => {
    const b = new LineBuffer()
    b.push('tail-no-newline')
    expect(b.flush()).toEqual(['tail-no-newline'])
    expect(b.flush()).toEqual([])
  })
})
```

```ts
// src/main/headless/parsers/text.test.ts
import { describe, expect, it } from 'vitest'
import { TextParser } from './text'

describe('TextParser', () => {
  it('passes every line through as log', () => {
    const p = new TextParser()
    expect(p.feed('hello\nworld\n')).toEqual([
      { kind: 'log', text: 'hello' },
      { kind: 'log', text: 'world' }
    ])
  })
  it('emits session once from sessionIdPattern (capture group preferred)', () => {
    const p = new TextParser('session id: ([0-9a-f-]+)')
    const ev = p.feed('session id: abc-123\nsession id: def-456\n')
    expect(ev.filter((e) => e.kind === 'session')).toEqual([{ kind: 'session', id: 'abc-123' }])
  })
  it('ignores an invalid pattern instead of throwing', () => {
    const p = new TextParser('([bad')
    expect(p.feed('x\n')).toEqual([{ kind: 'log', text: 'x' }])
  })
  it('flush drains the partial tail', () => {
    const p = new TextParser()
    p.feed('no-newline')
    expect(p.flush()).toEqual([{ kind: 'log', text: 'no-newline' }])
  })
})
```

- [ ] **Step 2: Run to verify failure** — `pnpm test -- headless` → FAIL (modules missing).
- [ ] **Step 3: Implement**

```ts
// src/main/headless/parser.ts
export type ParsedEvent = { kind: 'log'; text: string } | { kind: 'session'; id: string }

export interface StreamParser {
  feed(chunk: string): ParsedEvent[]
  flush(): ParsedEvent[]
}

// Accumulates stream chunks and yields only complete lines; the partial tail
// waits for the next chunk (or flush() at process exit).
export class LineBuffer {
  private buf = ''

  push(chunk: string): string[] {
    this.buf += chunk
    const lines = this.buf.split(/\r?\n/)
    this.buf = lines.pop() ?? ''
    return lines
  }

  flush(): string[] {
    const rest = this.buf
    this.buf = ''
    return rest ? [rest] : []
  }
}
```

```ts
// src/main/headless/parsers/text.ts
import { LineBuffer, type ParsedEvent, type StreamParser } from '../parser'

export class TextParser implements StreamParser {
  private readonly lines = new LineBuffer()
  private readonly sessionRegex: RegExp | null
  private sessionFound = false

  constructor(sessionIdPattern?: string) {
    let re: RegExp | null = null
    if (sessionIdPattern) {
      try {
        re = new RegExp(sessionIdPattern)
      } catch {
        // invalid user pattern — log passthrough still works, resume just won't
      }
    }
    this.sessionRegex = re
  }

  feed(chunk: string): ParsedEvent[] {
    return this.lines.push(chunk).flatMap((l) => this.line(l))
  }

  flush(): ParsedEvent[] {
    return this.lines.flush().flatMap((l) => this.line(l))
  }

  private line(l: string): ParsedEvent[] {
    const out: ParsedEvent[] = [{ kind: 'log', text: l }]
    if (!this.sessionFound && this.sessionRegex) {
      const m = l.match(this.sessionRegex)
      if (m) {
        this.sessionFound = true
        out.push({ kind: 'session', id: m[1] ?? m[0] })
      }
    }
    return out
  }
}
```

- [ ] **Step 4: Run tests** — `pnpm test -- headless` → PASS.
- [ ] **Step 5: Gate + commit**

```bash
pnpm typecheck && pnpm test
git add src/main/headless
git commit -m "feat(headless): stream parser core + text parser"
```

---

### Task 3: claude-stream-json parser

**Files:**
- Create: `src/main/headless/parsers/claude-stream-json.ts`
- Test: `src/main/headless/parsers/claude-stream-json.test.ts`

**Interfaces:**
- Consumes: `LineBuffer`, `ParsedEvent`, `StreamParser` from `../parser`
- Produces: `class ClaudeStreamJsonParser implements StreamParser` (no-arg constructor)

- [ ] **Step 1: Write failing tests** (fixture lines are trimmed from a REAL claude 2.1.191 run)

```ts
// src/main/headless/parsers/claude-stream-json.test.ts
import { describe, expect, it } from 'vitest'
import { ClaudeStreamJsonParser } from './claude-stream-json'

const INIT = '{"type":"system","subtype":"init","cwd":"C:\\\\repo","session_id":"1941ebac-946a-4036-982b-0a504eee8f0d","tools":[],"model":"claude-fable-5"}'
const HOOK = '{"type":"system","subtype":"hook_started","hook_id":"h1","hook_name":"SessionStart:startup","session_id":"1941ebac"}'
const RATE = '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"},"session_id":"1941ebac"}'
const TEXT = '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Opening a PR now."}]},"session_id":"1941ebac"}'
const THINK = '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"hmm"}]},"session_id":"1941ebac"}'
const TOOL = '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu1","name":"Edit","input":{"file_path":"src/foo.ts","old_string":"a"}}]},"session_id":"1941ebac"}'
const RESULT = '{"type":"result","subtype":"success","is_error":false,"result":"done","session_id":"1941ebac"}'

describe('ClaudeStreamJsonParser', () => {
  it('emits session + log from init', () => {
    const p = new ClaudeStreamJsonParser()
    expect(p.feed(INIT + '\n')).toEqual([
      { kind: 'session', id: '1941ebac-946a-4036-982b-0a504eee8f0d' },
      { kind: 'log', text: '▸ session 1941ebac-946a-4036-982b-0a504eee8f0d' }
    ])
  })
  it('renders assistant text verbatim and tool_use as a one-liner', () => {
    const p = new ClaudeStreamJsonParser()
    expect(p.feed(TEXT + '\n' + TOOL + '\n')).toEqual([
      { kind: 'log', text: 'Opening a PR now.' },
      { kind: 'log', text: '▸ Edit src/foo.ts' }
    ])
  })
  it('skips hook noise, rate limits, and thinking blocks', () => {
    const p = new ClaudeStreamJsonParser()
    expect(p.feed(HOOK + '\n' + RATE + '\n' + THINK + '\n')).toEqual([])
  })
  it('summarizes the result event as a status line', () => {
    const p = new ClaudeStreamJsonParser()
    expect(p.feed(RESULT + '\n')).toEqual([{ kind: 'log', text: '✔ run finished' }])
    const p2 = new ClaudeStreamJsonParser()
    expect(p2.feed('{"type":"result","subtype":"error","is_error":true}\n')).toEqual([
      { kind: 'log', text: '✘ run failed' }
    ])
  })
  it('passes non-JSON lines through as raw log', () => {
    const p = new ClaudeStreamJsonParser()
    expect(p.feed('plain noise\n')).toEqual([{ kind: 'log', text: 'plain noise' }])
  })
  it('survives a JSON line split across chunks', () => {
    const p = new ClaudeStreamJsonParser()
    const half = TEXT.slice(0, 40)
    expect(p.feed(half)).toEqual([])
    expect(p.feed(TEXT.slice(40) + '\n')).toEqual([{ kind: 'log', text: 'Opening a PR now.' }])
  })
})
```

- [ ] **Step 2: Run to verify failure** — `pnpm test -- claude-stream` → FAIL (module missing).
- [ ] **Step 3: Implement**

```ts
// src/main/headless/parsers/claude-stream-json.ts
import { LineBuffer, type ParsedEvent, type StreamParser } from '../parser'

const MAX_ARG = 120

// Best-effort one-line summary of a tool call's most identifying input.
function toolArg(input: Record<string, unknown>): string {
  const v = input.file_path ?? input.path ?? input.command ?? input.pattern ?? input.url ?? ''
  return String(v).replace(/\s+/g, ' ').slice(0, MAX_ARG)
}

export class ClaudeStreamJsonParser implements StreamParser {
  private readonly lines = new LineBuffer()

  feed(chunk: string): ParsedEvent[] {
    return this.lines.push(chunk).flatMap((l) => this.line(l))
  }

  flush(): ParsedEvent[] {
    return this.lines.flush().flatMap((l) => this.line(l))
  }

  private line(l: string): ParsedEvent[] {
    if (!l.trim()) return []
    let ev: Record<string, unknown>
    try {
      ev = JSON.parse(l) as Record<string, unknown>
    } catch {
      return [{ kind: 'log', text: l }] // stdout noise — never lose it
    }
    if (ev.type === 'system' && ev.subtype === 'init' && typeof ev.session_id === 'string') {
      return [
        { kind: 'session', id: ev.session_id },
        { kind: 'log', text: `▸ session ${ev.session_id}` }
      ]
    }
    if (ev.type === 'assistant') {
      const msg = ev.message as { content?: unknown[] } | undefined
      const out: ParsedEvent[] = []
      for (const raw of msg?.content ?? []) {
        const b = raw as { type?: string; text?: string; name?: string; input?: Record<string, unknown> }
        if (b.type === 'text' && b.text) out.push({ kind: 'log', text: b.text })
        else if (b.type === 'tool_use' && b.name) {
          out.push({ kind: 'log', text: `▸ ${b.name} ${toolArg(b.input ?? {})}`.trimEnd() })
        }
      }
      return out
    }
    if (ev.type === 'result') {
      return [{ kind: 'log', text: ev.is_error ? '✘ run failed' : '✔ run finished' }]
    }
    // Known-but-uninteresting stream events (hooks, rate limits, user/tool results):
    // valid JSON that isn't one of the rendered types is skipped, not logged.
    return []
  }
}
```

- [ ] **Step 4: Run tests** — `pnpm test -- claude-stream` → PASS.
- [ ] **Step 5: Gate + commit**

```bash
pnpm typecheck && pnpm test
git add src/main/headless/parsers/claude-stream-json.ts src/main/headless/parsers/claude-stream-json.test.ts
git commit -m "feat(headless): claude stream-json parser"
```

---

### Task 4: codex-jsonl parser + parser factory

**Files:**
- Create: `src/main/headless/parsers/codex-jsonl.ts`
- Create: `src/main/headless/parsers/index.ts`
- Test: `src/main/headless/parsers/codex-jsonl.test.ts`, `src/main/headless/parsers/index.test.ts`

**Interfaces:**
- Produces: `class CodexJsonlParser implements StreamParser` (no-arg constructor)
- Produces: `createParser(name: 'claude-stream-json' | 'codex-jsonl' | 'text', sessionIdPattern?: string): StreamParser`

- [ ] **Step 1: Write failing tests** (fixture lines verbatim from developers.openai.com/codex/noninteractive)

```ts
// src/main/headless/parsers/codex-jsonl.test.ts
import { describe, expect, it } from 'vitest'
import { CodexJsonlParser } from './codex-jsonl'

const THREAD = '{"type":"thread.started","thread_id":"0199a213-81c0-7800-8aa1-bbab2a035a53"}'
const TURN = '{"type":"turn.started"}'
const CMD = '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"bash -lc ls","status":"in_progress"}}'
const CMD_DONE = '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"bash -lc ls","status":"completed"}}'
const MSG = '{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"Repo contains docs, sdk, and examples directories."}}'
const FAILED = '{"type":"turn.failed","error":{"message":"boom"}}'

describe('CodexJsonlParser', () => {
  it('emits session + log from thread.started', () => {
    const p = new CodexJsonlParser()
    expect(p.feed(THREAD + '\n')).toEqual([
      { kind: 'session', id: '0199a213-81c0-7800-8aa1-bbab2a035a53' },
      { kind: 'log', text: '▸ thread 0199a213-81c0-7800-8aa1-bbab2a035a53' }
    ])
  })
  it('logs command starts and agent messages, skips command completions and turn.started', () => {
    const p = new CodexJsonlParser()
    expect(p.feed([TURN, CMD, CMD_DONE, MSG].join('\n') + '\n')).toEqual([
      { kind: 'log', text: '▸ run bash -lc ls' },
      { kind: 'log', text: 'Repo contains docs, sdk, and examples directories.' }
    ])
  })
  it('surfaces turn.failed with its message', () => {
    const p = new CodexJsonlParser()
    expect(p.feed(FAILED + '\n')).toEqual([{ kind: 'log', text: '✘ turn failed: boom' }])
  })
  it('passes non-JSON lines through as raw log', () => {
    const p = new CodexJsonlParser()
    expect(p.feed('warning: something\n')).toEqual([{ kind: 'log', text: 'warning: something' }])
  })
  it('treats valid-JSON primitives and arrays as raw log, not events', () => {
    const p = new CodexJsonlParser()
    expect(p.feed('null\n[1,2,3]\n')).toEqual([
      { kind: 'log', text: 'null' },
      { kind: 'log', text: '[1,2,3]' }
    ])
  })
})
```

```ts
// src/main/headless/parsers/index.test.ts
import { describe, expect, it } from 'vitest'
import { createParser } from './index'
import { ClaudeStreamJsonParser } from './claude-stream-json'
import { CodexJsonlParser } from './codex-jsonl'
import { TextParser } from './text'

describe('createParser', () => {
  it('maps each name to its parser', () => {
    expect(createParser('claude-stream-json')).toBeInstanceOf(ClaudeStreamJsonParser)
    expect(createParser('codex-jsonl')).toBeInstanceOf(CodexJsonlParser)
    expect(createParser('text')).toBeInstanceOf(TextParser)
  })
  it('threads sessionIdPattern into the text parser', () => {
    const p = createParser('text', 'id=(\\w+)')
    const ev = p.feed('id=abc\n')
    expect(ev).toContainEqual({ kind: 'session', id: 'abc' })
  })
})
```

- [ ] **Step 2: Run to verify failure** — `pnpm test -- codex-jsonl` → FAIL.
- [ ] **Step 3: Implement**

```ts
// src/main/headless/parsers/codex-jsonl.ts
import { LineBuffer, type ParsedEvent, type StreamParser } from '../parser'

export class CodexJsonlParser implements StreamParser {
  private readonly lines = new LineBuffer()

  feed(chunk: string): ParsedEvent[] {
    return this.lines.push(chunk).flatMap((l) => this.line(l))
  }

  flush(): ParsedEvent[] {
    return this.lines.flush().flatMap((l) => this.line(l))
  }

  private line(l: string): ParsedEvent[] {
    if (!l.trim()) return []
    let ev: Record<string, unknown>
    try {
      ev = JSON.parse(l) as Record<string, unknown>
    } catch {
      return [{ kind: 'log', text: l }]
    }
    // JSON.parse also accepts primitives and arrays ('null', '[1]', '"x"') —
    // not events; treat them as noise too instead of throwing on .type access.
    if (typeof ev !== 'object' || ev === null || Array.isArray(ev)) {
      return [{ kind: 'log', text: l }]
    }
    const item = ev.item as { type?: string; command?: string; text?: string } | undefined
    switch (ev.type) {
      case 'thread.started':
        return typeof ev.thread_id === 'string'
          ? [
              { kind: 'session', id: ev.thread_id },
              { kind: 'log', text: `▸ thread ${ev.thread_id}` }
            ]
          : []
      case 'item.started':
        return item?.type === 'command_execution' && item.command
          ? [{ kind: 'log', text: `▸ run ${item.command}` }]
          : []
      case 'item.completed':
        return item?.type === 'agent_message' && item.text ? [{ kind: 'log', text: item.text }] : []
      case 'turn.failed': {
        const msg = (ev.error as { message?: string } | undefined)?.message
        return [{ kind: 'log', text: `✘ turn failed${msg ? `: ${msg}` : ''}` }]
      }
      case 'error':
        return [{ kind: 'log', text: `✘ ${typeof ev.message === 'string' ? ev.message : 'error'}` }]
      default:
        return [] // turn.started / turn.completed / future event types
    }
  }
}
```

```ts
// src/main/headless/parsers/index.ts
import type { StreamParser } from '../parser'
import { ClaudeStreamJsonParser } from './claude-stream-json'
import { CodexJsonlParser } from './codex-jsonl'
import { TextParser } from './text'

export function createParser(
  name: 'claude-stream-json' | 'codex-jsonl' | 'text',
  sessionIdPattern?: string
): StreamParser {
  if (name === 'claude-stream-json') return new ClaudeStreamJsonParser()
  if (name === 'codex-jsonl') return new CodexJsonlParser()
  return new TextParser(sessionIdPattern)
}
```

- [ ] **Step 4: Run tests** — `pnpm test -- parsers` → PASS.
- [ ] **Step 5: Gate + commit**

```bash
pnpm typecheck && pnpm test
git add src/main/headless/parsers
git commit -m "feat(headless): codex jsonl parser + parser factory"
```

---

### Task 5: PrCollector (collect-all PR detection)

`PrDetector` (first-match-then-stop) keeps working until Task 9 deletes it with the PTY-YOLO path. Add `PrCollector` beside it.

**Files:**
- Modify: `src/main/terminal/pr-detector.ts`
- Test: `src/main/terminal/pr-detector.test.ts` (add cases; keep existing PrDetector cases passing until Task 9)

**Interfaces:**
- Produces: `class PrCollector { constructor(patterns: ForgePattern[], maxBuffer?: number); feed(chunk: string): { url: string; term: string }[]; get urls(): string[] }`

- [ ] **Step 1: Write failing tests**

```ts
// add to src/main/terminal/pr-detector.test.ts
import { PrCollector, buildForgePatterns } from './pr-detector'

describe('PrCollector', () => {
  const patterns = [
    { term: 'PR', regex: new RegExp('https://github\\.com/[^/\\s]+/[^/\\s]+/pull/\\d+') }
  ]
  it('collects multiple distinct PRs in order', () => {
    const c = new PrCollector(patterns)
    expect(c.feed('see https://github.com/a/b/pull/1 and\n')).toEqual([
      { url: 'https://github.com/a/b/pull/1', term: 'PR' }
    ])
    expect(c.feed('also https://github.com/a/c/pull/2\n')).toEqual([
      { url: 'https://github.com/a/c/pull/2', term: 'PR' }
    ])
    expect(c.urls).toEqual(['https://github.com/a/b/pull/1', 'https://github.com/a/c/pull/2'])
  })
  it('dedupes a URL seen twice', () => {
    const c = new PrCollector(patterns)
    c.feed('https://github.com/a/b/pull/1\n')
    expect(c.feed('again https://github.com/a/b/pull/1\n')).toEqual([])
    expect(c.urls).toEqual(['https://github.com/a/b/pull/1'])
  })
  it('finds a URL split across two feeds', () => {
    const c = new PrCollector(patterns)
    expect(c.feed('https://github.com/a/b/pu')).toEqual([])
    expect(c.feed('ll/7 done\n')).toEqual([{ url: 'https://github.com/a/b/pull/7', term: 'PR' }])
  })
})
```

- [ ] **Step 2: Run to verify failure** — `pnpm test -- pr-detector` → FAIL (PrCollector not exported).
- [ ] **Step 3: Implement** — append to `src/main/terminal/pr-detector.ts`:

```ts
// Collect-all variant for headless YOLO: every distinct PR/MR URL, in first-seen
// order, across the whole run (a monorepo run can open several).
export class PrCollector {
  private buffer = ''
  private readonly seen = new Set<string>()
  private readonly ordered: string[] = []

  constructor(
    private readonly patterns: ForgePattern[],
    private readonly maxBuffer = 8192
  ) {}

  feed(chunk: string): { url: string; term: string }[] {
    this.buffer = (this.buffer + chunk).slice(-this.maxBuffer)
    const hits: { url: string; term: string }[] = []
    for (const p of this.patterns) {
      const global = new RegExp(p.regex.source, p.regex.flags.includes('g') ? p.regex.flags : p.regex.flags + 'g')
      for (const m of this.buffer.matchAll(global)) {
        if (!this.seen.has(m[0])) {
          this.seen.add(m[0])
          this.ordered.push(m[0])
          hits.push({ url: m[0], term: p.term })
        }
      }
    }
    return hits
  }

  get urls(): string[] {
    return [...this.ordered]
  }
}
```

- [ ] **Step 4: Run tests** — `pnpm test -- pr-detector` → PASS (old PrDetector cases too).
- [ ] **Step 5: Gate + commit**

```bash
pnpm typecheck && pnpm test
git add src/main/terminal/pr-detector.ts src/main/terminal/pr-detector.test.ts
git commit -m "feat(headless): PrCollector — all PR URLs, deduped, ordered"
```

---

### Task 6: Headless launch builder (recap appending lives here)

**Files:**
- Create: `src/main/headless/launch.ts`
- Test: `src/main/headless/launch.test.ts`

**Interfaces:**
- Consumes: `Config`, `resolveCwd` (`../terminal/resolve`), `ResolvedCommand` (`../terminal/resolve-command`), `DEFAULT_YOLO_RECAP` (`../config/presets`)
- Produces:

```ts
interface HeadlessLaunch {
  file: string; args: string[]; cwd: string; prompt: string
  outputParser: 'claude-stream-json' | 'codex-jsonl' | 'text'
  sessionIdPattern?: string; toolName: string; canResume: boolean
  resolved?: ResolvedCommand
}
function buildHeadlessLaunch(
  config: Config,
  opts: { tool?: string; ticketKey?: string; cwdOverride?: string },
  expandedPrompt: string,
  resolveCommand?: (command: string) => ResolvedCommand | undefined
): HeadlessLaunch
```

- [ ] **Step 1: Write failing tests**

```ts
// src/main/headless/launch.test.ts
import { describe, expect, it } from 'vitest'
import { buildHeadlessLaunch } from './launch'
import { DEFAULT_YOLO_RECAP } from '../config/presets'
import { ConfigSchema, type Config } from '../config/schema'

function cfg(over: Record<string, unknown> = {}): Config {
  return ConfigSchema.parse({
    jira: { baseUrl: 'https://x.atlassian.net', email: 'a@b.co', apiToken: 't' },
    defaultTool: 'claude',
    cliTools: {
      claude: {
        command: 'claude',
        headless: { args: ['-p', '--output-format', 'stream-json'], outputParser: 'claude-stream-json' },
        resumeArgs: ['--resume', '{{sessionId}}']
      },
      bare: { command: 'bare' }
    },
    repos: [{ key: 'PROJ', path: 'C:/repos/proj' }],
    ...over
  })
}

describe('buildHeadlessLaunch', () => {
  it('builds file/args/cwd from tool + ticket mapping', () => {
    const l = buildHeadlessLaunch(cfg(), { ticketKey: 'PROJ-1' }, 'do it')
    expect(l.file).toBe('claude')
    expect(l.args).toEqual(['-p', '--output-format', 'stream-json'])
    expect(l.cwd).toBe('C:/repos/proj')
    expect(l.outputParser).toBe('claude-stream-json')
    expect(l.canResume).toBe(true)
  })
  it('appends the default recap to the prompt', () => {
    const l = buildHeadlessLaunch(cfg(), {}, 'do it')
    expect(l.prompt).toBe(`do it\n\n${DEFAULT_YOLO_RECAP}`)
  })
  it('config yoloRecap overrides the default; empty string disables', () => {
    expect(buildHeadlessLaunch(cfg({ yoloRecap: 'custom recap' }), {}, 'p').prompt).toBe('p\n\ncustom recap')
    expect(buildHeadlessLaunch(cfg({ yoloRecap: '' }), {}, 'p').prompt).toBe('p')
  })
  it('throws for a tool without headless config', () => {
    expect(() => buildHeadlessLaunch(cfg(), { tool: 'bare' }, 'p')).toThrow(/no headless/i)
  })
  it('throws for an unknown tool', () => {
    expect(() => buildHeadlessLaunch(cfg(), { tool: 'nope' }, 'p')).toThrow(/Unknown CLI tool/)
  })
  it('canResume is false without resumeArgs', () => {
    const c = cfg()
    c.cliTools.claude.resumeArgs = undefined
    expect(buildHeadlessLaunch(c, {}, 'p').canResume).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure** — `pnpm test -- launch` → FAIL.
- [ ] **Step 3: Implement**

```ts
// src/main/headless/launch.ts
import type { Config } from '../config/schema'
import type { ResolvedCommand } from '../terminal/resolve-command'
import { resolveCwd } from '../terminal/resolve'
import { DEFAULT_YOLO_RECAP } from '../config/presets'

export interface HeadlessLaunch {
  file: string
  args: string[]
  cwd: string
  prompt: string
  outputParser: 'claude-stream-json' | 'codex-jsonl' | 'text'
  sessionIdPattern?: string
  toolName: string
  canResume: boolean
  resolved?: ResolvedCommand
}

export function buildHeadlessLaunch(
  config: Config,
  opts: { tool?: string; ticketKey?: string; cwdOverride?: string },
  expandedPrompt: string,
  resolveCommand?: (command: string) => ResolvedCommand | undefined
): HeadlessLaunch {
  const toolName = opts.tool ?? config.defaultTool
  const tool = config.cliTools[toolName]
  if (!tool) throw new Error(`Unknown CLI tool: ${toolName}`)
  if (!tool.headless) throw new Error(`Tool "${toolName}" has no headless config — YOLO unavailable`)

  const recap = (config.yoloRecap ?? DEFAULT_YOLO_RECAP).trim()
  return {
    file: tool.command,
    args: [...tool.headless.args],
    cwd: resolveCwd(config, opts.ticketKey, opts.cwdOverride),
    // The prompt travels over stdin only (never argv) — see spawn-command.ts.
    prompt: recap ? `${expandedPrompt}\n\n${recap}` : expandedPrompt,
    outputParser: tool.headless.outputParser,
    sessionIdPattern: tool.headless.sessionIdPattern,
    toolName,
    canResume: (tool.resumeArgs?.length ?? 0) > 0,
    resolved: resolveCommand?.(tool.command)
  }
}
```

- [ ] **Step 4: Run tests** — `pnpm test -- launch` → PASS.
- [ ] **Step 5: Gate + commit**

```bash
pnpm typecheck && pnpm test
git add src/main/headless/launch.ts src/main/headless/launch.test.ts
git commit -m "feat(headless): launch builder with yoloRecap appending"
```

---

### Task 7: YoloRunner + real node spawner (integration-tested)

**Files:**
- Create: `src/main/headless/runner.ts`
- Create: `src/main/headless/node-spawner.ts`
- Test: `src/main/headless/runner.test.ts` (unit, fake spawner), `src/main/headless/node-spawner.test.ts` (integration, real `node -e` child)

**Interfaces:**
- Consumes: `StreamParser`, `ParsedEvent` (`./parser`); `PrCollector`, `ForgePattern` (`../terminal/pr-detector`); `resolveSpawnCommand` (`../terminal/spawn-command`); `ResolvedCommand`
- Produces:

```ts
interface HeadlessChild {
  onStdout(cb: (chunk: string) => void): void
  onStderr(cb: (chunk: string) => void): void
  onExit(cb: (exitCode: number) => void): void
  writeAndCloseStdin(data: string): void
  kill(): void
}
type HeadlessSpawner = (opts: { file: string; args: string[]; cwd: string; resolved?: ResolvedCommand }) => HeadlessChild
interface YoloCallbacks {
  onLog(id: string, text: string): void
  onPr(id: string, url: string, term: string): void
  onExit(id: string, e: { exitCode: number; sessionId?: string; prUrls: string[] }): void
}
class YoloRunner {
  constructor(spawn: HeadlessSpawner, cb: YoloCallbacks)
  start(id: string, opts: { file: string; args: string[]; cwd: string; prompt: string; parser: StreamParser; patterns: ForgePattern[]; resolved?: ResolvedCommand }): void
  kill(id: string): void
  killAll(): void
  has(id: string): boolean
}
const nodeHeadlessSpawner: HeadlessSpawner   // from node-spawner.ts
```

- [ ] **Step 1: Write failing unit tests**

```ts
// src/main/headless/runner.test.ts
import { describe, expect, it, vi } from 'vitest'
import { YoloRunner, type HeadlessChild } from './runner'
import { TextParser } from './parsers/text'

function fakeChild(): HeadlessChild & {
  stdout: (chunk: string) => void
  exit: (code: number) => void
  stdin: string[]
  killed: boolean
} {
  const child = {
    stdin: [] as string[],
    killed: false,
    stdout: (_: string) => {},
    stderrCb: (_: string) => {},
    exit: (_: number) => {},
    onStdout(cb: (c: string) => void) { child.stdout = cb },
    onStderr(cb: (c: string) => void) { child.stderrCb = cb },
    onExit(cb: (code: number) => void) { child.exit = cb },
    writeAndCloseStdin(data: string) { child.stdin.push(data) },
    kill() { child.killed = true }
  }
  return child
}

const GH = [{ term: 'PR', regex: new RegExp('https://github\\.com/[^/\\s]+/[^/\\s]+/pull/\\d+') }]

describe('YoloRunner', () => {
  it('delivers the prompt to stdin, streams logs, captures session + PRs, reports exit', () => {
    const child = fakeChild()
    const cb = { onLog: vi.fn(), onPr: vi.fn(), onExit: vi.fn() }
    const runner = new YoloRunner(() => child, cb)
    runner.start('y1', {
      file: 'x', args: [], cwd: '.', prompt: 'PROMPT',
      parser: new TextParser('session id: (\\S+)'), patterns: GH
    })
    expect(child.stdin).toEqual(['PROMPT'])
    child.stdout('session id: abc\nopened https://github.com/a/b/pull/9\n')
    expect(cb.onLog).toHaveBeenCalledWith('y1', 'session id: abc')
    expect(cb.onPr).toHaveBeenCalledWith('y1', 'https://github.com/a/b/pull/9', 'PR')
    child.exit(0)
    expect(cb.onExit).toHaveBeenCalledWith('y1', { exitCode: 0, sessionId: 'abc', prUrls: ['https://github.com/a/b/pull/9'] })
    expect(runner.has('y1')).toBe(false)
  })
  it('flushes the parser tail on exit', () => {
    const child = fakeChild()
    const cb = { onLog: vi.fn(), onPr: vi.fn(), onExit: vi.fn() }
    new YoloRunner(() => child, cb).start('y1', {
      file: 'x', args: [], cwd: '.', prompt: 'p', parser: new TextParser(), patterns: []
    })
    child.stdout('no newline yet')
    child.exit(0)
    expect(cb.onLog).toHaveBeenCalledWith('y1', 'no newline yet')
  })
  it('rejects a duplicate id and kill() kills the child', () => {
    const child = fakeChild()
    const cb = { onLog: vi.fn(), onPr: vi.fn(), onExit: vi.fn() }
    const runner = new YoloRunner(() => child, cb)
    runner.start('y1', { file: 'x', args: [], cwd: '.', prompt: 'p', parser: new TextParser(), patterns: [] })
    expect(() => runner.start('y1', { file: 'x', args: [], cwd: '.', prompt: 'p', parser: new TextParser(), patterns: [] })).toThrow(/already/)
    runner.kill('y1')
    expect(child.killed).toBe(true)
    expect(runner.has('y1')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure** — `pnpm test -- runner` → FAIL.
- [ ] **Step 3: Implement runner**

```ts
// src/main/headless/runner.ts
import type { ResolvedCommand } from '../terminal/resolve-command'
import { PrCollector, type ForgePattern } from '../terminal/pr-detector'
import { LineBuffer, type ParsedEvent, type StreamParser } from './parser'

export interface HeadlessChild {
  onStdout(cb: (chunk: string) => void): void
  onStderr(cb: (chunk: string) => void): void
  onExit(cb: (exitCode: number) => void): void
  writeAndCloseStdin(data: string): void
  kill(): void
}

export type HeadlessSpawner = (opts: {
  file: string
  args: string[]
  cwd: string
  resolved?: ResolvedCommand
}) => HeadlessChild

export interface YoloCallbacks {
  onLog(id: string, text: string): void
  onPr(id: string, url: string, term: string): void
  onExit(id: string, e: { exitCode: number; sessionId?: string; prUrls: string[] }): void
}

export class YoloRunner {
  private readonly runs = new Map<string, HeadlessChild>()

  constructor(
    private readonly spawn: HeadlessSpawner,
    private readonly cb: YoloCallbacks
  ) {}

  start(
    id: string,
    opts: {
      file: string
      args: string[]
      cwd: string
      prompt: string
      parser: StreamParser
      patterns: ForgePattern[]
      resolved?: ResolvedCommand
    }
  ): void {
    if (this.runs.has(id)) throw new Error(`YOLO run ${id} already exists`)
    const child = this.spawn({ file: opts.file, args: opts.args, cwd: opts.cwd, resolved: opts.resolved })
    let sessionId: string | undefined
    const collector = new PrCollector(opts.patterns)
    const stderrLines = new LineBuffer()

    const emit = (events: ParsedEvent[]): void => {
      for (const ev of events) {
        if (ev.kind === 'session') {
          sessionId ??= ev.id
        } else {
          this.cb.onLog(id, ev.text)
          for (const hit of collector.feed(ev.text + '\n')) this.cb.onPr(id, hit.url, hit.term)
        }
      }
    }

    child.onStdout((chunk) => emit(opts.parser.feed(chunk)))
    child.onStderr((chunk) => {
      for (const line of stderrLines.push(chunk)) if (line.trim()) this.cb.onLog(id, line)
    })
    child.onExit((exitCode) => {
      emit(opts.parser.flush())
      for (const line of stderrLines.flush()) if (line.trim()) this.cb.onLog(id, line)
      this.runs.delete(id)
      this.cb.onExit(id, { exitCode, sessionId, prUrls: collector.urls })
    })
    child.writeAndCloseStdin(opts.prompt)
    this.runs.set(id, child)
  }

  kill(id: string): void {
    this.runs.get(id)?.kill()
    this.runs.delete(id)
  }

  killAll(): void {
    for (const child of this.runs.values()) child.kill()
    this.runs.clear()
  }

  has(id: string): boolean {
    return this.runs.has(id)
  }
}
```

- [ ] **Step 4: Run unit tests** — `pnpm test -- runner` → PASS.
- [ ] **Step 5: Write failing integration test for the real spawner**

```ts
// src/main/headless/node-spawner.test.ts
import { describe, expect, it } from 'vitest'
import { nodeHeadlessSpawner } from './node-spawner'

// Real child process: echoes stdin to stdout, writes one stderr line, exits 7.
const SCRIPT =
  'let d="";process.stdin.on("data",(c)=>d+=c).on("end",()=>{process.stdout.write("got:"+d+"\\n");process.stderr.write("warn\\n");process.exit(7)})'

describe('nodeHeadlessSpawner (integration)', () => {
  it('round-trips stdin → stdout, surfaces stderr, reports the exit code', async () => {
    const child = nodeHeadlessSpawner({ file: process.execPath, args: ['-e', SCRIPT], cwd: process.cwd() })
    let out = ''
    let err = ''
    const exit = new Promise<number>((res) => child.onExit(res))
    child.onStdout((c) => (out += c))
    child.onStderr((c) => (err += c))
    child.writeAndCloseStdin('PING')
    expect(await exit).toBe(7)
    expect(out).toContain('got:PING')
    expect(err).toContain('warn')
  })
  it('reports a spawn failure as exit -1 instead of throwing', async () => {
    const child = nodeHeadlessSpawner({ file: 'definitely-not-a-real-binary-xyz.exe', args: [], cwd: process.cwd() })
    const exit = new Promise<number>((res) => child.onExit(res))
    child.writeAndCloseStdin('x')
    expect(await exit).toBe(-1)
  })
})
```

Note: `process.execPath` is a full path to `node.exe` — an explicit `.exe` path, so on Windows `resolveSpawnCommand` with no `resolved` routes it through `cmd /c`, which still works (args contain no untrusted text in this test; real launches pass `resolved`). The spawn-failure test relies on the `error` event mapping to exit -1.

- [ ] **Step 6: Run to verify failure** — `pnpm test -- node-spawner` → FAIL (module missing).
- [ ] **Step 7: Implement the spawner**

```ts
// src/main/headless/node-spawner.ts
import { spawn, spawnSync } from 'node:child_process'
import { resolveSpawnCommand } from '../terminal/spawn-command'
import type { HeadlessSpawner } from './runner'

// Real child_process-backed spawner. Reuses resolveSpawnCommand so a PATH shim
// (claude.cmd / codex.cmd) rides through `cmd /c` on Windows — safe here because
// headless args are fixed config values; the prompt goes over stdin only.
export const nodeHeadlessSpawner: HeadlessSpawner = (opts) => {
  const { file, args } = resolveSpawnCommand(
    process.platform,
    opts.file,
    opts.args,
    process.env.ComSpec ?? 'cmd.exe',
    opts.resolved
  )
  const child = spawn(file, args, { cwd: opts.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  let exited = false
  let exitCb: (code: number) => void = () => {}
  const fireExit = (code: number): void => {
    if (!exited) {
      exited = true
      exitCb(code)
    }
  }
  child.on('error', () => fireExit(-1)) // spawn failure (ENOENT) or kill error
  child.on('close', (code) => fireExit(code ?? -1))
  return {
    onStdout: (cb) => void child.stdout.on('data', cb),
    onStderr: (cb) => void child.stderr.on('data', cb),
    onExit: (cb) => {
      exitCb = cb
    },
    writeAndCloseStdin: (data) => {
      // Swallow EPIPE from an already-dead child; exit reporting covers it.
      child.stdin.on('error', () => {})
      child.stdin.write(data, () => child.stdin.end())
    },
    kill: () => {
      if (process.platform === 'win32' && child.pid) {
        // child.kill() only kills the direct child; the CLI's own children
        // (git/gh/test runners) would survive and keep mutating the repo.
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'])
      } else {
        child.kill('SIGTERM')
      }
    }
  }
}
```

- [ ] **Step 8: Run tests** — `pnpm test -- node-spawner` → PASS.
- [ ] **Step 9: Gate + commit**

```bash
pnpm typecheck && pnpm test
git add src/main/headless/runner.ts src/main/headless/runner.test.ts src/main/headless/node-spawner.ts src/main/headless/node-spawner.test.ts
git commit -m "feat(headless): YoloRunner + child_process spawner"
```

---

### Task 8: IPC — shared types, prompt-resolution extraction, yolo handlers, preload, main wiring

**Files:**
- Modify: `src/shared/ipc.ts`
- Create: `src/main/ipc/resolve-prompt.ts` (extracted from terminal-handlers)
- Modify: `src/main/ipc/terminal-handlers.ts` (import the extraction; nothing else yet)
- Create: `src/main/ipc/yolo-handlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`
- Test: `src/main/ipc/yolo-handlers.test.ts`

**Interfaces (produces):**

```ts
// shared/ipc.ts additions
export interface StartYoloRequest {
  id: string
  tool?: string
  ticketKey?: string
  cwdOverride?: string
  prompt?: { name?: string; text?: string }
}
export interface YoloLogEvent { id: string; text: string }
export interface YoloPrEvent { id: string; url: string; term: string }
export interface YoloExitEvent {
  id: string; exitCode: number; sessionId?: string
  cwd: string; tool: string; canResume: boolean; prUrls: string[]
}
export interface YoloCaps { available: boolean }
export const YOLO = {
  start: 'yolo:start', log: 'yolo:log', pr: 'yolo:pr',
  exit: 'yolo:exit', kill: 'yolo:kill', caps: 'yolo:caps'
} as const
```

- `resolve-prompt.ts` exports `resolveExpandedPrompt(config, deps, req)` — the exact function currently private in `terminal-handlers.ts:32-52` (its `req` param type widens to `{ prompt?: { name?: string; text?: string }; ticketKey?: string }`).
- `registerYoloIpc(config: Config, getSender: () => Electron.WebContents | undefined, spawner: HeadlessSpawner, deps: TerminalDeps): YoloRunner`
- Preload gains: `startYolo(req): Promise<SpawnResult>`, `killYolo(id): void`, `yoloCaps(): Promise<YoloCaps>`, `onYoloLog(cb): () => void`, `onYoloPr(cb): () => void`, `onYoloExit(cb): () => void`.

- [ ] **Step 1: Move `resolveExpandedPrompt`** — cut the function and its imports (`findPrompt`, `buildPromptTicket`, `expandPrompt`, `resolveForge`) from `terminal-handlers.ts` into:

```ts
// src/main/ipc/resolve-prompt.ts
import type { Config } from '../config/schema'
import type { Ticket } from '../../shared/types'
import { type PromptTemplate, findPrompt } from '../prompts/library'
import { buildPromptTicket, expandPrompt, resolveForge } from '../prompts/expand'

export interface PromptRequest {
  prompt?: { name?: string; text?: string }
  ticketKey?: string
}

export interface PromptDeps {
  getTicket: (key: string) => Promise<Ticket>
  prompts: PromptTemplate[]
}

export async function resolveExpandedPrompt(
  config: Config,
  deps: PromptDeps,
  req: PromptRequest
): Promise<string | undefined> {
  if (!req.prompt) return undefined
  let body = req.prompt.text
  if (req.prompt.name) {
    const tmpl = findPrompt(deps.prompts, req.prompt.name)
    if (!tmpl) throw new Error(`Unknown prompt: ${req.prompt.name}`)
    body = tmpl.body
  }
  if (body === undefined) return undefined

  const ticket = req.ticketKey
    ? await deps.getTicket(req.ticketKey)
    : { key: '', type: '', status: '', summary: '', descriptionAdf: null, acceptanceCriteria: null, comments: [], url: '' }
  const ticketCtx = buildPromptTicket(ticket, config.ticketContext)
  const forge = resolveForge(config, req.ticketKey)
  return expandPrompt(body, { ticket: ticketCtx, forge })
}
```

In `terminal-handlers.ts`: delete the local copy, `import { resolveExpandedPrompt } from './resolve-prompt'`, drop the now-unused imports. Run `pnpm test -- terminal-handlers` → still PASS (pure move).

- [ ] **Step 2: Add the YOLO block to `src/shared/ipc.ts`** (types exactly as in Interfaces above, appended after the `STARTUP` block).

- [ ] **Step 3: Write failing handler tests** (follow the existing `terminal-handlers.test.ts` pattern for mocking `electron`'s `ipcMain` — read that file first and mirror its mock; the test drives the registered handler functions directly)

```ts
// src/main/ipc/yolo-handlers.test.ts — core assertions (adapt the electron mock
// from terminal-handlers.test.ts verbatim; it captures ipcMain.handle/on registrations)
import { describe, expect, it, vi } from 'vitest'
import { registerYoloIpc } from './yolo-handlers'
import { YOLO } from '../../shared/ipc'
import { ConfigSchema } from '../config/schema'
import type { HeadlessChild } from '../headless/runner'

// ... electron ipcMain mock exactly as in terminal-handlers.test.ts ...

const config = ConfigSchema.parse({
  jira: { baseUrl: 'https://x.atlassian.net', email: 'a@b.co', apiToken: 't' },
  defaultTool: 'claude',
  cliTools: {
    claude: {
      command: 'claude',
      headless: { args: ['-p'], outputParser: 'text', sessionIdPattern: 'sid=(\\S+)' },
      resumeArgs: ['--resume', '{{sessionId}}']
    }
  },
  forges: { github: { prCommand: 'gh pr create', term: 'PR', urlPattern: 'https://github\\.com/[^/\\s]+/[^/\\s]+/pull/\\d+' } },
  repos: [{ key: 'PROJ', path: 'C:/repos/proj' }]
})

describe('yolo handlers', () => {
  it('start: expands prompt, spawns headless, streams log/pr, exit carries resume payload', async () => {
    // fake spawner as in runner.test.ts; sender = { send: vi.fn() }
    // invoke the captured YOLO.start handler with:
    //   { id: 'y1', ticketKey: 'PROJ-1', prompt: { text: 'work {{ticket.key}}' } }
    // then: child.stdout('sid=abc\nhttps://github.com/a/b/pull/3\n'); child.exit(0)
    // assert sender.send calls:
    //   (YOLO.log, { id: 'y1', text: 'sid=abc' })
    //   (YOLO.pr,  { id: 'y1', url: 'https://github.com/a/b/pull/3', term: 'PR' })
    //   (YOLO.exit, { id: 'y1', exitCode: 0, sessionId: 'abc', cwd: 'C:/repos/proj', tool: 'claude', canResume: true, prUrls: ['https://github.com/a/b/pull/3'] })
    // assert child.stdin[0] starts with 'work PROJ-1' and ends with the recap text
  })
  it('start without a prompt returns ok:false', async () => {
    // invoke handler with { id: 'y2' } → { ok: false, error: /requires a prompt/ }
  })
  it('caps reflects whether the default tool has a headless block', async () => {
    // YOLO.caps handler → { available: true } for this config
  })
  it('kill forwards to the runner', () => {
    // registered YOLO.kill listener kills the fake child
  })
})
```

Write these as REAL tests (the comments above define the exact expected values — the implementer expands them into code using the electron mock pattern from `terminal-handlers.test.ts`; the expected `send` payloads are normative).

- [ ] **Step 4: Run to verify failure** — `pnpm test -- yolo-handlers` → FAIL.
- [ ] **Step 5: Implement**

```ts
// src/main/ipc/yolo-handlers.ts
import { ipcMain } from 'electron'
import type { Config } from '../config/schema'
import { YOLO, type SpawnResult, type StartYoloRequest, type YoloCaps } from '../../shared/ipc'
import { buildHeadlessLaunch } from '../headless/launch'
import { createParser } from '../headless/parsers'
import { YoloRunner, type HeadlessSpawner } from '../headless/runner'
import { buildForgePatterns } from '../terminal/pr-detector'
import { resolveExpandedPrompt } from './resolve-prompt'
import type { TerminalDeps } from './terminal-handlers'

export function registerYoloIpc(
  config: Config,
  getSender: () => Electron.WebContents | undefined,
  spawner: HeadlessSpawner,
  deps: TerminalDeps
): YoloRunner {
  // Per-run context the exit event needs (resume cwd/tool) — keyed by run id.
  const meta = new Map<string, { cwd: string; tool: string; canResume: boolean }>()

  const runner = new YoloRunner(spawner, {
    onLog: (id, text) => getSender()?.send(YOLO.log, { id, text }),
    onPr: (id, url, term) => getSender()?.send(YOLO.pr, { id, url, term }),
    onExit: (id, e) => {
      const m = meta.get(id)
      meta.delete(id)
      getSender()?.send(YOLO.exit, {
        id,
        exitCode: e.exitCode,
        sessionId: e.sessionId,
        cwd: m?.cwd ?? '',
        tool: m?.tool ?? '',
        canResume: Boolean(e.sessionId) && (m?.canResume ?? false),
        prUrls: e.prUrls
      })
    }
  })

  ipcMain.handle(YOLO.start, async (_e, req: StartYoloRequest): Promise<SpawnResult> => {
    try {
      if (!req.prompt?.name && !req.prompt?.text) throw new Error('YOLO session requires a prompt')
      const expanded = await resolveExpandedPrompt(config, deps, req)
      const launch = buildHeadlessLaunch(config, req, expanded ?? '', deps.resolveCommand)
      meta.set(req.id, { cwd: launch.cwd, tool: launch.toolName, canResume: launch.canResume })
      runner.start(req.id, {
        file: launch.file,
        args: launch.args,
        cwd: launch.cwd,
        prompt: launch.prompt,
        parser: createParser(launch.outputParser, launch.sessionIdPattern),
        patterns: buildForgePatterns(config),
        resolved: launch.resolved
      })
      return { ok: true }
    } catch (err) {
      meta.delete(req.id)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(YOLO.caps, (): YoloCaps => ({
    available: Boolean(config.cliTools[config.defaultTool]?.headless)
  }))

  ipcMain.on(YOLO.kill, (_e, id: string) => {
    runner.kill(id)
    meta.delete(id)
  })

  return runner
}
```

- [ ] **Step 6: Preload additions** (`src/preload/index.ts`) — extend imports with `YOLO, type StartYoloRequest, type YoloCaps, type YoloLogEvent, type YoloPrEvent, type YoloExitEvent` and add to `api`:

```ts
  startYolo: (req: StartYoloRequest): Promise<SpawnResult> => ipcRenderer.invoke(YOLO.start, req),
  killYolo: (id: string): void => ipcRenderer.send(YOLO.kill, id),
  yoloCaps: (): Promise<YoloCaps> => ipcRenderer.invoke(YOLO.caps),
  onYoloLog: (cb: (e: YoloLogEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: YoloLogEvent): void => cb(payload)
    ipcRenderer.on(YOLO.log, listener)
    return () => ipcRenderer.off(YOLO.log, listener)
  },
  onYoloPr: (cb: (e: YoloPrEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: YoloPrEvent): void => cb(payload)
    ipcRenderer.on(YOLO.pr, listener)
    return () => ipcRenderer.off(YOLO.pr, listener)
  },
  onYoloExit: (cb: (e: YoloExitEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: YoloExitEvent): void => cb(payload)
    ipcRenderer.on(YOLO.exit, listener)
    return () => ipcRenderer.off(YOLO.exit, listener)
  }
```

- [ ] **Step 7: Wire main** (`src/main/index.ts`) — add imports `registerYoloIpc` and `nodeHeadlessSpawner`, hold `let yolo: YoloRunner | null = null`, and inside the `if (loadedConfig)` block after `registerTerminalIpc`:

```ts
    yolo = registerYoloIpc(
      cfg,
      () => BrowserWindow.getFocusedWindow()?.webContents ?? BrowserWindow.getAllWindows()[0]?.webContents,
      nodeHeadlessSpawner,
      { getTicket: (key) => client.fetchIssue(key), prompts, resolveCommand: systemResolveCommand }
    )
```

Extend both shutdown hooks: `app.on('before-quit', () => { terminals?.killAll(); yolo?.killAll() })` and the same in `window-all-closed`.

- [ ] **Step 8: Run tests** — `pnpm test -- yolo-handlers` → PASS; `pnpm typecheck` → PASS.
- [ ] **Step 9: Commit**

```bash
git add src/shared/ipc.ts src/main/ipc/resolve-prompt.ts src/main/ipc/terminal-handlers.ts src/main/ipc/yolo-handlers.ts src/main/ipc/yolo-handlers.test.ts src/preload/index.ts src/main/index.ts
git commit -m "feat(headless): YOLO IPC surface + preload bridge + main wiring"
```

---

### Task 9: Interactive resume + delete the PTY-YOLO path

**Files:**
- Modify: `src/main/terminal/session.ts` (+ its test)
- Modify: `src/main/ipc/terminal-handlers.ts` (+ its test)
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/config/schema.ts`, `src/main/config/presets.ts` (+ `load.test.ts`)
- Modify: `src/main/terminal/pr-detector.ts` (+ test): delete `PrDetector` class, keep `PrCollector` + `buildForgePatterns`
- Modify: `src/main/cli/parse-args.ts`? NO — untouched (`--yolo` still parses to `mode: 'yolo'`).

**Interfaces:**
- `buildInteractiveLaunch(config, opts: { tool?: string; ticketKey?: string; cwdOverride?: string; resume?: { sessionId: string } }, expandedPrompt?, resolveCommand?)` — `yolo` opt GONE, `resume` added.
- `SpawnTerminalRequest`: `yolo?: boolean` removed; `resume?: { sessionId: string }` added. `TERM.pr` channel and `TerminalPrEvent` removed (`YoloPrEvent` covers YOLO; interactive tabs no longer detect PRs). Preload: remove `onTerminalPr`.

- [ ] **Step 1: Write/adjust failing tests** — in `src/main/terminal/session.test.ts`, replace the yolo-args test(s) with:

```ts
  it('appends expanded resumeArgs after interactiveArgs', () => {
    // config with cliTools.claude = { command: 'claude', interactiveArgs: ['--ide'], resumeArgs: ['--resume', '{{sessionId}}'] }
    const launch = buildInteractiveLaunch(config, { resume: { sessionId: 'abc-123' } })
    expect(launch.args).toEqual(['--ide', '--resume', 'abc-123'])
  })
  it('ignores resume when the tool has no resumeArgs', () => {
    const launch = buildInteractiveLaunch(configWithoutResumeArgs, { resume: { sessionId: 'abc' } })
    expect(launch.args).toEqual([])
  })
```

- [ ] **Step 2: Run to verify failure** — `pnpm test -- session` → FAIL (`resume` not handled; old yolo tests now compile-error — delete them in the same edit).
- [ ] **Step 3: Implement in `session.ts`** — replace the opts type and the args line:

```ts
export function buildInteractiveLaunch(
  config: Config,
  opts: { tool?: string; ticketKey?: string; cwdOverride?: string; resume?: { sessionId: string } },
  expandedPrompt?: string,
  resolveCommand?: (command: string) => ResolvedCommand | undefined
): Launch {
  const toolName = opts.tool ?? config.defaultTool
  const tool = config.cliTools[toolName]
  if (!tool) throw new Error(`Unknown CLI tool: ${toolName}`)
  const cwd = resolveCwd(config, opts.ticketKey, opts.cwdOverride)
  // Function replacer: a literal '$' in a session id must not trigger $&-style patterns.
  const resumeArgs =
    opts.resume && tool.resumeArgs
      ? tool.resumeArgs.map((a) => a.replace('{{sessionId}}', () => opts.resume!.sessionId))
      : []
  const args = [...tool.interactiveArgs, ...resumeArgs]
  const resolved = resolveCommand?.(tool.command)
  // ... rest of the function unchanged (arg/stdin prompt delivery logic) ...
```

- [ ] **Step 4: Clean `terminal-handlers.ts`** — delete: `PrDetector`/`buildForgePatterns` imports and the `detectors` map, the `det`/`TERM.pr` block in `onData`, `detectors.delete(id)` in `onExit`, and the `if (req.yolo) detectors.set(...)` line. Delete the yolo/PR cases from `terminal-handlers.test.ts`. Keep ALL prompt-delivery code.
- [ ] **Step 5: Clean `shared/ipc.ts`** — remove `yolo?: boolean` from `SpawnTerminalRequest`, add `resume?: { sessionId: string }`; delete `TerminalPrEvent` and the `pr: 'pty:pr'` entry from `TERM`. In `src/preload/index.ts` delete `onTerminalPr` and the `TerminalPrEvent` import.
- [ ] **Step 6: Clean config** — remove `yoloArgs` from `CliToolSchema` and both presets (Zod strips the key from old user configs — assert that with the existing "legacy yoloArgs" schema test from Task 1, which must still pass). Update the `load.test.ts` merge test that references `yoloArgs` to use another preserved field (e.g. `headless`), and update the stale `mergeByKey` comment in `load.ts` ("safety-relevant yoloArgs" → "safety-relevant headless args").
- [ ] **Step 7: Delete `PrDetector`** — remove the class from `pr-detector.ts` and its cases from `pr-detector.test.ts` (keep `buildForgePatterns` + `PrCollector`).
- [ ] **Step 8: Renderer compile fixes only** — `TerminalView.vue`: remove the `yolo` prop and `yolo:` field from the spawn request, remove the `pr` ref / `onTerminalPr` / PR-card template block (PR cards return in Task 10 inside YoloView); `RightPanel.vue` still passes `:yolo` — remove just that binding so typecheck passes (full RightPanel rework is Task 11). `NewSessionMenu.vue` still emits `yolo: boolean` in its payload — that stays (it selects the tab kind in Task 11).
- [ ] **Step 9: Gate + commit**

Run: `pnpm typecheck && pnpm test`
Expected: PASS with the yolo-flag tests replaced by resume tests; count delta vs. baseline explained entirely by removed/added cases.

```bash
git add src/main/terminal/session.ts src/main/terminal/session.test.ts src/main/ipc/terminal-handlers.ts src/main/ipc/terminal-handlers.test.ts src/shared/ipc.ts src/preload/index.ts src/main/config/schema.ts src/main/config/presets.ts src/main/config/load.ts src/main/config/load.test.ts src/main/config/schema.test.ts src/main/terminal/pr-detector.ts src/main/terminal/pr-detector.test.ts src/renderer/src/components/TerminalView.vue src/renderer/src/components/RightPanel.vue
git commit -m "feat(terminal): interactive resume via resumeArgs; delete PTY-YOLO path"
```

---

### Task 10: Renderer — shared term style, PrCard, YoloView

**Files:**
- Create: `src/renderer/src/term-style.ts`
- Create: `src/renderer/src/components/PrCard.vue`
- Create: `src/renderer/src/components/YoloView.vue`
- Modify: `src/renderer/src/components/TerminalView.vue` (use the shared font constants)
- Test: `src/renderer/src/components/YoloView.test.ts`

**Interfaces:**
- `term-style.ts` exports `TERM_FONT_FAMILY = 'Consolas, monospace'` and `TERM_FONT_SIZE = 13` (the exact values currently hardcoded in `TerminalView.vue:19`).
- `PrCard.vue`: props `{ url: string; term: string }`; renders the existing `.pr-card` markup/styles (moved verbatim from TerminalView) and calls `window.api.openExternal(url)` on Open.
- `YoloView.vue`: props `{ id: string; ticketKey: string | null; prompt?: { name?: string; text?: string }; tool?: string }`; emits `exited(code: number)` and `resume(payload: { sessionId: string; cwd: string; tool: string })`.

- [ ] **Step 1: Extract style + PrCard**

```ts
// src/renderer/src/term-style.ts
// One source of truth for the console typeface — xterm options (TerminalView)
// and the YOLO log (YoloView) must never drift apart.
export const TERM_FONT_FAMILY = 'Consolas, monospace'
export const TERM_FONT_SIZE = 13
```

```vue
<!-- src/renderer/src/components/PrCard.vue -->
<script setup lang="ts">
const props = defineProps<{ url: string; term: string }>()
function open(): void {
  void window.api.openExternal(props.url).catch(() => {})
}
</script>

<template>
  <div class="pr-card">
    <span class="pr-card__label">✅ {{ term }} ready</span>
    <button class="pr-card__open" @click="open">Open</button>
  </div>
</template>

<style scoped>
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

In `TerminalView.vue`, replace the hardcoded font options with the constants:

```ts
import { TERM_FONT_FAMILY, TERM_FONT_SIZE } from '../term-style'
// ...
term = new Terminal({ fontFamily: TERM_FONT_FAMILY, fontSize: TERM_FONT_SIZE, cursorBlink: true, theme: { background: '#1a1f1d' } })
```

- [ ] **Step 2: Write failing YoloView tests** (mirror the mounting/mock pattern of `RightPanel.test.ts` — `window.api` is stubbed with `vi.fn()`s whose `onYolo*` registrations are captured so the test can push events)

```ts
// src/renderer/src/components/YoloView.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import YoloView from './YoloView.vue'
import type { YoloExitEvent, YoloLogEvent, YoloPrEvent } from '../../../shared/ipc'

let logCb: (e: YoloLogEvent) => void
let prCb: (e: YoloPrEvent) => void
let exitCb: (e: YoloExitEvent) => void

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    startYolo: vi.fn().mockResolvedValue({ ok: true }),
    killYolo: vi.fn(),
    openExternal: vi.fn().mockResolvedValue({ ok: true }),
    onYoloLog: vi.fn((cb) => { logCb = cb; return () => {} }),
    onYoloPr: vi.fn((cb) => { prCb = cb; return () => {} }),
    onYoloExit: vi.fn((cb) => { exitCb = cb; return () => {} })
  }
})

function exitEvent(over: Partial<YoloExitEvent> = {}): YoloExitEvent {
  return { id: 'y1', exitCode: 0, sessionId: 'sid-1', cwd: 'C:/repos/proj', tool: 'claude', canResume: true, prUrls: [], ...over }
}

describe('YoloView', () => {
  it('starts the run and appends log lines', async () => {
    const w = mount(YoloView, { props: { id: 'y1', ticketKey: 'PROJ-1', prompt: { name: 'fix-bug' } } })
    await flushPromises()
    expect(window.api.startYolo).toHaveBeenCalledWith({ id: 'y1', ticketKey: 'PROJ-1', prompt: { name: 'fix-bug', text: undefined }, tool: undefined })
    logCb({ id: 'y1', text: 'working…' })
    logCb({ id: 'other', text: 'not mine' })
    await flushPromises()
    expect(w.text()).toContain('working…')
    expect(w.text()).not.toContain('not mine')
  })
  it('stacks PR cards', async () => {
    const w = mount(YoloView, { props: { id: 'y1', ticketKey: null, prompt: { text: 'p' } } })
    await flushPromises()
    prCb({ id: 'y1', url: 'https://github.com/a/b/pull/1', term: 'PR' })
    prCb({ id: 'y1', url: 'https://github.com/a/c/pull/2', term: 'PR' })
    await flushPromises()
    expect(w.findAll('.pr-card')).toHaveLength(2)
  })
  it('shows the resume button after exit and emits resume once', async () => {
    const w = mount(YoloView, { props: { id: 'y1', ticketKey: null, prompt: { text: 'p' } } })
    await flushPromises()
    exitCb(exitEvent())
    await flushPromises()
    const btn = w.get('button.yolo-resume')
    await btn.trigger('click')
    expect(w.emitted('resume')).toEqual([[{ sessionId: 'sid-1', cwd: 'C:/repos/proj', tool: 'claude' }]])
    expect((w.get('button.yolo-resume').element as HTMLButtonElement).disabled).toBe(true)
  })
  it('shows the unavailable note when canResume is false', async () => {
    const w = mount(YoloView, { props: { id: 'y1', ticketKey: null, prompt: { text: 'p' } } })
    await flushPromises()
    exitCb(exitEvent({ canResume: false, sessionId: undefined, exitCode: 3 }))
    await flushPromises()
    expect(w.find('button.yolo-resume').exists()).toBe(false)
    expect(w.text()).toContain('resume unavailable')
    expect(w.text()).toContain('exited with code 3')
  })
  it('renders a start failure and emits exited', async () => {
    ;(window.api.startYolo as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: 'boom' })
    const w = mount(YoloView, { props: { id: 'y1', ticketKey: null, prompt: { text: 'p' } } })
    await flushPromises()
    expect(w.text()).toContain('failed to start: boom')
    expect(w.emitted('exited')).toBeTruthy()
  })
  it('kills the run on unmount only while still running', async () => {
    const w = mount(YoloView, { props: { id: 'y1', ticketKey: null, prompt: { text: 'p' } } })
    await flushPromises()
    w.unmount()
    expect(window.api.killYolo).toHaveBeenCalledWith('y1')
    const w2 = mount(YoloView, { props: { id: 'y2', ticketKey: null, prompt: { text: 'p' } } })
    await flushPromises()
    exitCb(exitEvent({ id: 'y2' }))
    await flushPromises()
    ;(window.api.killYolo as ReturnType<typeof vi.fn>).mockClear()
    w2.unmount()
    expect(window.api.killYolo).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run to verify failure** — `pnpm test -- YoloView` → FAIL.
- [ ] **Step 4: Implement YoloView**

```vue
<!-- src/renderer/src/components/YoloView.vue -->
<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import PrCard from './PrCard.vue'
import { TERM_FONT_FAMILY, TERM_FONT_SIZE } from '../term-style'
import type { YoloExitEvent } from '../../../shared/ipc'

const props = defineProps<{
  id: string
  ticketKey: string | null
  prompt?: { name?: string; text?: string }
  tool?: string
}>()
const emit = defineEmits<{
  (e: 'exited', code: number): void
  (e: 'resume', payload: { sessionId: string; cwd: string; tool: string }): void
}>()

const lines = ref<string[]>([])
const prs = ref<{ url: string; term: string }[]>([])
const exit = ref<YoloExitEvent | null>(null)
const resumed = ref(false)
const logHost = ref<HTMLElement | null>(null)
let offLog: (() => void) | null = null
let offPr: (() => void) | null = null
let offExit: (() => void) | null = null

// Pin to bottom unless the user scrolled up to read.
function append(text: string): void {
  const el = logHost.value
  const pinned = !el || el.scrollTop + el.clientHeight >= el.scrollHeight - 8
  lines.value.push(text)
  if (pinned) void nextTick(() => logHost.value?.scrollTo({ top: logHost.value.scrollHeight }))
}

onMounted(async () => {
  offLog = window.api.onYoloLog((e) => { if (e.id === props.id) append(e.text) })
  offPr = window.api.onYoloPr((e) => { if (e.id === props.id) prs.value.push({ url: e.url, term: e.term }) })
  offExit = window.api.onYoloExit((e) => {
    if (e.id !== props.id) return
    exit.value = e
    emit('exited', e.exitCode)
  })
  try {
    // Unwrap the reactive prompt Proxy — ipcRenderer.invoke can't clone it.
    const res = await window.api.startYolo({
      id: props.id,
      ticketKey: props.ticketKey ?? undefined,
      prompt: props.prompt ? { name: props.prompt.name, text: props.prompt.text } : undefined,
      tool: props.tool
    })
    if (!res.ok) fail(res.error)
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err))
  }
})

function fail(error: string): void {
  append(`[failed to start: ${error}]`)
  exit.value = { id: props.id, exitCode: -1, cwd: '', tool: props.tool ?? '', canResume: false, prUrls: [] }
  emit('exited', -1)
}

function resume(): void {
  if (!exit.value?.sessionId || resumed.value) return
  resumed.value = true
  emit('resume', { sessionId: exit.value.sessionId, cwd: exit.value.cwd, tool: exit.value.tool })
}

onBeforeUnmount(() => {
  offLog?.()
  offPr?.()
  offExit?.()
  if (!exit.value) window.api.killYolo(props.id)
})
</script>

<template>
  <div class="yolo-wrap">
    <PrCard v-for="p in prs" :key="p.url" :url="p.url" :term="p.term" />
    <pre
      ref="logHost"
      class="yolo-log"
      :style="{ fontFamily: TERM_FONT_FAMILY, fontSize: TERM_FONT_SIZE + 'px' }"
    >{{ lines.join('\n') }}</pre>
    <div v-if="exit" class="yolo-footer">
      <span :class="exit.exitCode === 0 ? 'yolo-status--ok' : 'yolo-status--bad'">
        {{ exit.exitCode === 0 ? '✔ finished' : `✘ exited with code ${exit.exitCode}` }}
      </span>
      <button v-if="exit.canResume" class="yolo-resume" :disabled="resumed" @click="resume">
        Resume YOLO Session?
      </button>
      <span v-else class="yolo-muted">resume unavailable — no session id captured</span>
    </div>
  </div>
</template>

<style scoped>
.yolo-wrap { display: flex; flex-direction: column; height: 100%; }
.yolo-log {
  flex: 1; min-height: 0; overflow: auto; margin: 0; padding: 8px 10px;
  background: #1a1f1d; color: var(--ink); border-radius: var(--radius-sm);
  white-space: pre-wrap; word-break: break-word;
}
.yolo-footer {
  display: flex; align-items: center; gap: 12px; justify-content: space-between;
  padding: 8px 10px; border-top: 1px solid var(--hairline);
}
.yolo-status--ok { color: var(--green); font-weight: 600; }
.yolo-status--bad { color: var(--ink); font-weight: 600; }
.yolo-resume {
  background: var(--teal); color: var(--bg); border: 0;
  border-radius: var(--radius-sm); padding: 6px 14px; cursor: pointer; font-weight: 600;
}
.yolo-resume:disabled { opacity: 0.5; cursor: default; }
.yolo-resume:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.yolo-muted { color: var(--ink-muted); font-size: 12px; }
</style>
```

- [ ] **Step 5: Run tests** — `pnpm test -- YoloView` → PASS.
- [ ] **Step 6: Gate + commit**

```bash
pnpm typecheck && pnpm test
git add src/renderer/src/term-style.ts src/renderer/src/components/PrCard.vue src/renderer/src/components/YoloView.vue src/renderer/src/components/YoloView.test.ts src/renderer/src/components/TerminalView.vue
git commit -m "feat(renderer): YoloView live log tab + shared PrCard/term font"
```

---

### Task 11: Renderer wiring — tab kinds, resume tab, menu capability, TerminalView resume props

**Files:**
- Modify: `src/renderer/src/components/RightPanel.vue` (+ `RightPanel.test.ts`)
- Modify: `src/renderer/src/components/TerminalView.vue`
- Modify: `src/renderer/src/components/NewSessionMenu.vue`

**Interfaces:**
- `Term` model: `{ id: string; title: string; kind: 'terminal' | 'yolo'; prompt?: { name?: string; text?: string }; tool?: string; exited?: boolean; resume?: { sessionId: string }; cwdOverride?: string }`
- `TerminalView` props gain `resume?: { sessionId: string }` and `cwdOverride?: string`, forwarded into `spawnTerminal`.
- `NewSessionMenu` keeps emitting `{ prompt?, yolo: boolean }`; the YOLO toggle is disabled when `window.api.yoloCaps()` says unavailable.

- [ ] **Step 1: Write/adjust failing tests** — in `RightPanel.test.ts` (mirroring its existing stub pattern; stub `YoloView` too), add:

```ts
  it('startStartupSession mode=yolo opens a yolo-kind tab', async () => {
    // call startStartupSession({ mode: 'yolo', promptName: 'fix-bug' })
    // assert a YoloView stub is rendered and no TerminalView
  })
  it('yolo resume event opens a terminal tab with resume + cwdOverride', async () => {
    // open a yolo tab, emit resume({ sessionId: 'sid', cwd: 'C:/x', tool: 'claude' }) from the stub
    // assert a new TerminalView stub rendered with props resume={sessionId:'sid'}, cwdOverride='C:/x', tool='claude'
    // and its tab title ends with '(resumed)'
  })
```

(Expand the comments into real assertions using the file's existing helpers — the expected props/titles above are normative.)

- [ ] **Step 2: Run to verify failure** — `pnpm test -- RightPanel` → FAIL.
- [ ] **Step 3: Implement RightPanel** — script section becomes:

```ts
import { ref } from 'vue'
import TerminalView from './TerminalView.vue'
import YoloView from './YoloView.vue'
import NewSessionMenu from './NewSessionMenu.vue'

defineProps<{ activeTicketKey: string | null }>()

interface Term {
  id: string
  title: string
  kind: 'terminal' | 'yolo'
  prompt?: { name?: string; text?: string }
  tool?: string
  exited?: boolean
  resume?: { sessionId: string }
  cwdOverride?: string
}
const terms = ref<Term[]>([])
const activeId = ref<string | null>(null)
let counter = 0

function addTerm(t: Omit<Term, 'id'>): void {
  counter += 1
  const id = `t${counter}-${Date.now()}`
  terms.value.push({ id, ...t })
  activeId.value = id
}

function startSession(payload: { prompt?: { name?: string; text?: string }; yolo?: boolean; tool?: string }): void {
  const base = payload.prompt?.name ?? (payload.yolo ? 'yolo' : 'Session')
  addTerm({
    title: `${base} ${counter + 1}`,
    kind: payload.yolo ? 'yolo' : 'terminal',
    prompt: payload.prompt,
    tool: payload.tool
  })
}

function startStartupSession(s: { mode: 'interactive' | 'yolo'; promptName?: string; promptText?: string; tool?: string }): void {
  const prompt = s.promptName ? { name: s.promptName } : s.promptText ? { text: s.promptText } : undefined
  startSession({ prompt, yolo: s.mode === 'yolo', tool: s.tool })
}

defineExpose({ startStartupSession })

function resumeYolo(from: Term, p: { sessionId: string; cwd: string; tool: string }): void {
  addTerm({
    title: `${from.title} (resumed)`,
    kind: 'terminal',
    tool: p.tool || undefined,
    resume: { sessionId: p.sessionId },
    cwdOverride: p.cwd || undefined
  })
}

function closeTerm(id: string): void {
  const i = terms.value.findIndex((t) => t.id === id)
  if (i === -1) return
  terms.value.splice(i, 1)
  if (activeId.value === id) activeId.value = terms.value.at(-1)?.id ?? null
}

function markExited(id: string): void {
  const t = terms.value.find((t) => t.id === id)
  if (t) t.exited = true
}
```

Template `term-slot` body becomes:

```html
      <div
        v-for="t in terms"
        v-show="t.id === activeId"
        :key="t.id"
        class="term-slot"
      >
        <YoloView
          v-if="t.kind === 'yolo'"
          :id="t.id"
          :ticket-key="activeTicketKey"
          :prompt="t.prompt"
          :tool="t.tool"
          @exited="markExited(t.id)"
          @resume="resumeYolo(t, $event)"
        />
        <TerminalView
          v-else
          :id="t.id"
          :ticket-key="activeTicketKey"
          :prompt="t.prompt"
          :tool="t.tool"
          :resume="t.resume"
          :cwd-override="t.cwdOverride"
          @exited="markExited(t.id)"
        />
      </div>
```

- [ ] **Step 4: TerminalView resume props** — add to props: `resume?: { sessionId: string }; cwdOverride?: string`, and extend the spawn request:

```ts
    const res = await window.api.spawnTerminal({
      id: props.id,
      ticketKey: props.ticketKey ?? undefined,
      cwdOverride: props.cwdOverride,
      cols: term.cols,
      rows: term.rows,
      prompt: props.prompt ? { name: props.prompt.name, text: props.prompt.text } : undefined,
      resume: props.resume ? { sessionId: props.resume.sessionId } : undefined,
      tool: props.tool
    })
```

- [ ] **Step 5: NewSessionMenu capability gate** — add near the other refs and in `onMounted`:

```ts
const yoloAvailable = ref(false)
// inside onMounted, after listPrompts:
try { yoloAvailable.value = (await window.api.yoloCaps()).available } catch { yoloAvailable.value = false }
```

And the YOLO toggle button becomes:

```html
        <button
          type="button"
          :class="{ 'mode--on': mode === 'yolo' }"
          :disabled="!yoloAvailable"
          :title="yoloAvailable ? '' : 'Default tool has no headless config'"
          @click="mode = 'yolo'"
        >YOLO ⚡</button>
```

Add a disabled style: `.mode-toggle button:disabled { opacity: 0.4; cursor: default; }`

- [ ] **Step 6: Run tests** — `pnpm test -- RightPanel` → PASS (update any existing RightPanel tests that stubbed only TerminalView / passed `yolo` props).
- [ ] **Step 7: Gate + commit**

```bash
pnpm typecheck && pnpm test
git add src/renderer/src/components/RightPanel.vue src/renderer/src/components/RightPanel.test.ts src/renderer/src/components/TerminalView.vue src/renderer/src/components/NewSessionMenu.vue
git commit -m "feat(renderer): yolo tab kind, resume-to-interactive tab, menu capability gate"
```

---

### Task 12: Docs, spec amendment, full gate, manual checklist

**Files:**
- Modify: `README.md` (YOLO section: headless behavior, `yoloRecap`, resume button, config example)
- Modify: `docs/superpowers/specs/2026-07-02-headless-yolo-design.md`

- [ ] **Step 1: README** — update the YOLO description: YOLO runs headless (`claude -p --output-format stream-json` / `codex exec --json`), live log tab, all PR links surfaced, `yoloRecap` config (show the default), "Resume YOLO Session?" button, and the config snippet from the spec (`headless` / `resumeArgs` / `yoloRecap`; `yoloArgs` gone).
- [ ] **Step 2: Spec amendment** — in the spec's parser section, replace the three-kind `ParsedEvent` with the implemented two kinds and add one line: "`result`-kind events were dropped during implementation — the final assistant text already carries the recap; the runner needs only `log` and `session`." In the spec's IPC block, extend `YOLO.exit` to the implemented shape `{ id, exitCode, sessionId?, cwd, tool, canResume, prUrls[] }` (the renderer needs `tool`/`canResume` to render the resume button without a tool registry).
- [ ] **Step 3: Full gate vs. baseline** — `pnpm typecheck && pnpm test`; compare counts to Task 0's baseline and account for every delta. Also `pnpm build` once to prove electron-vite still bundles all three processes.
- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/specs/2026-07-02-headless-yolo-design.md
git commit -m "docs: headless YOLO README + spec amendment"
```

- [ ] **Step 5: Manual verification (USER — cannot be automated):**
  1. `npm install -g @openai/codex` (codex is not currently installed on this machine).
  2. `pnpm dev` → open a real ticket → New session → YOLO → pick a prompt → watch the live log, confirm the run ends with the recap and a PR card, click the PR link.
  3. Click "Resume YOLO Session?" → confirm a new interactive tab opens with `claude --resume <id>` in the ticket's repo cwd and the conversation context is intact.
  4. Repeat 2–3 with `--tool codex` (or `defaultTool: codex`) → confirms `codex exec --json - --dangerously-bypass-approvals-and-sandbox` streams, `thread.started` id is captured, and `codex resume <id>` works.
  5. `seniordev PROJ-123 --yolo fix-bug` from a terminal → confirms the CLI path opens a headless tab.

Merge to `develop` only after the user's manual pass, with `git merge --no-ff feature/headless-yolo -m "merge: headless YOLO with live log + resume"`.
