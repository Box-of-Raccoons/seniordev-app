# SeniorDev — Headless YOLO redesign

**Date:** 2026-07-02
**Status:** Approved (brainstorming) — pending spec review
**Supersedes:** the "YOLO execution = visible auto-run terminal" decision in
`2026-07-02-seniordev-design.md` and the Phase 4 implementation built on it.

## One-liner

YOLO runs become **headless**: the CLI agent runs in autonomous print mode as a
plain child process (no PTY), its activity streams into a live monospace log on
the tab, every PR/MR it creates is surfaced as a card, and after the run exits
the tab offers a **"Resume YOLO Session?"** button that opens a new interactive
terminal tab resuming that same session in the same repo.

## Decisions (locked during brainstorming)

| Fork | Decision | Why |
|---|---|---|
| In-run display | **Live streamed log** (parsed events → monospace log) | Keeps today's "watch it work" transparency without a TUI. No separate end-of-run summary UI. |
| Recap | **Keep the configurable recap instruction** (`yoloRecap`, appended to every YOLO prompt) | The agent's final message ends with a changes + PR recap — the last thing in the log. Built-in default, config-overridable. |
| Old PTY YOLO | **Fully replaced** — the visible-terminal YOLO path is deleted | Resume button covers the jump-in need; one YOLO code path. |
| Tool scope | **Both claude AND codex fully working** (headless + resume) in v1 | Config stays generic (`headless` block + `resumeArgs` template); presets ship for both. |
| Resume timing | **Only after the run exits** (success or failure) | Avoids mid-run kill/race handling (partial actions, session-state lag, exit races, Windows tree-kill orphans). |
| Runner architecture | **Approach A: `child_process.spawn` + per-tool stream parsers** | Only option giving a readable live log AND reliable session-id capture for both tools while staying config-driven. Rejected: B (headless flags inside existing PTY/xterm — no structured events, no session id in text mode), C (Agent SDK — vendor hard-wired into main, abandons the CLI registry). |
| Prompt delivery (headless) | **stdin pipe, always** | Both CLIs accept it; sidesteps the Windows `.cmd`-shim `cmd /c` re-parse injection surface entirely; no TUI paste/readiness machinery applies. |
| Multi-PR | **Collect all matches, deduped, in order** | A monorepo run opening N PRs yields N cards/links. |

## Config schema

`cliTools` entries lose `yoloArgs` and gain `headless` + `resumeArgs`; one new
top-level `yoloRecap`. All new fields optional — existing configs stay valid
(leftover `yoloArgs` keys are stripped by Zod).

```yaml
defaultTool: claude
cliTools:
  claude:
    command: claude
    interactiveArgs: []
    promptDelivery: stdin            # unchanged — interactive sessions only
    headless:
      args: [-p, --output-format, stream-json, --verbose, --permission-mode, auto]
      outputParser: claude-stream-json   # claude-stream-json | codex-jsonl | text
      # sessionIdPattern: '...'          # optional regex fallback, parser: text only
    resumeArgs: [--resume, '{{sessionId}}']
  codex:
    command: codex
    headless:
      args: [exec, --json]           # exact flags verified during planning
      outputParser: codex-jsonl
    resumeArgs: [resume, '{{sessionId}}']

yoloRecap: |                         # optional — built-in default ships in presets.ts
  When you are completely finished, end your final message with:
  1. "## Changes made" — every file you changed and a one-line why.
  2. "## Pull requests" — the URL of each PR/MR you created
     (one per project if this repo is a monorepo).
```

Semantics:

- **`headless.args`** — full flag set for an autonomous print-mode run. The
  prompt itself always goes over the **stdin pipe** (written, then the pipe is
  closed) — never as an argv element.
- **`headless.outputParser`** — selects a built-in parser (same config-selects-
  behavior pattern as forge `urlPattern`). Unknown tools use `text` plus
  optional `sessionIdPattern` for resume.
- **`resumeArgs`** — template appended to `interactiveArgs` when the Resume
  button spawns the follow-up tab; `{{sessionId}}` is substituted. Absent →
  the Resume button never renders for that tool.
- **`yoloRecap`** — appended (with a blank line) to every expanded YOLO prompt.
  Built-in default in `presets.ts`; config value overrides; empty string disables.
- A tool with no `headless` block doesn't offer YOLO (menu entry disabled).

Schema work (`schema.ts`): new `HeadlessSchema`
(`args: string[]`, `outputParser: enum, default 'text'`,
`sessionIdPattern?: string`), `resumeArgs?: string[]` on `CliToolSchema`,
`yoloRecap?: string` on `ConfigSchema`. `yoloArgs` is removed. Presets in
`presets.ts` updated for claude and codex.

## Main process — `src/main/headless/`

A new module beside `terminal/`, fully separate from the PTY path.

- **`runner.ts`** — spawns the CLI via `child_process.spawn` (stdout/stderr
  piped, never a PTY). Reuses the existing pieces: `resolveCwd` for ticket→repo,
  `expandPrompt` for template expansion (recap appended), `resolveCommand` for
  Windows `.cmd` shim resolution. Since the prompt goes over stdin, a shim
  launch (`cmd /c`) carries only fixed config-authored args — no injection
  surface. Writes the prompt to stdin, closes the pipe, streams output through
  the configured parser.
- **`parsers/`** — one interface, three implementations:
  `feed(chunk) → ParsedEvent[]` where an event is
  `{kind: 'log', text}` | `{kind: 'session', id}`.
  `result`-kind events were dropped during implementation — the final assistant
  text already carries the recap; the runner needs only `log` and `session`.
  - `claude-stream-json.ts` — splits JSONL; assistant text verbatim, tool calls
    as one-liners (e.g. `▸ Edit src/foo.ts`); session id from the init event.
  - `codex-jsonl.ts` — equivalent mapping for `codex exec --json` events.
  - `text.ts` — lines pass through; applies `sessionIdPattern` if configured.
  - All parsers buffer to newline boundaries and pass unparseable lines through
    as raw log text — a broken line never loses output or crashes the run.
- **PR detection** — the existing `PrDetector` is fed *parsed text* (not raw
  JSON) and collects **all** matches, deduped, in order (today it stops at the
  first). Detection wiring moves out of `terminal-handlers.ts` into the runner.

### IPC surface (`shared/ipc.ts`, mirroring `TERM`)

```
YOLO.start  (invoke)  { id, tool?, ticketKey?, cwdOverride?, prompt: {name?|text?} }
                      → { ok: true } | { ok: false, error }
YOLO.log    (event)   { id, text }                       — streamed log lines
YOLO.pr     (event)   { id, url, term }                  — each PR as detected
YOLO.exit   (event)   { id, exitCode, sessionId?, cwd, tool, canResume, prUrls[] }
YOLO.kill   (send)    { id }                             — close tab mid-run (tree-kill)
```

`YOLO.exit` carries everything resume needs: the captured session id, the
**cwd the run actually used** (the resume tab must spawn in the same repo),
`tool` (the tool name used for the run), and `canResume` (pre-computed boolean:
`true` when a session id was captured and the tool's `resumeArgs` is configured).
The renderer uses `tool` and `canResume` directly to render the Resume button
without needing to consult the tool registry.

`SpawnTerminalRequest` gains one optional field, `resume?: { sessionId: string }`;
`buildInteractiveLaunch` appends the tool's expanded `resumeArgs` to
`interactiveArgs` when present.

### Deletions

- `yolo` flag on `TERM.spawn` / `SpawnTerminalRequest`.
- The `yoloArgs` branch in `session.ts` and the field in `schema.ts`/`presets.ts`.
- Per-spawn `PrDetector` wiring in `terminal-handlers.ts` (PR detection now
  lives only in the headless runner).
- The stdin-readiness prompt-delivery machinery **stays** — it is still how
  interactive sessions receive their first prompt.

## Renderer

`RightPanel`'s tab model gains `kind: 'terminal' | 'yolo'`. Terminal tabs render
`TerminalView` (xterm) as today; YOLO tabs render a new **`YoloView.vue`**:

- **Live log** — auto-scrolling monospace pane appending `YOLO.log` lines.
  Uses the same font stack/size as the xterm terminals via one shared CSS
  variable (e.g. `--term-font`) so console and log cannot drift. Auto-scroll
  pins to bottom unless the user has scrolled up.
- **PR cards** — each `YOLO.pr` event renders the existing "✅ PR ready [Open]"
  card style; multiple PRs stack.
- **Footer after exit** — status line (`✔ finished` / `✘ exited with code N`).
  If a session id was captured **and** the tool has `resumeArgs`, the
  **"Resume YOLO Session?"** button renders at the bottom of the tab; otherwise
  a muted "resume unavailable — no session id captured" note.
- **Resume click** — opens a *new* terminal-kind tab titled after the original
  (e.g. `fix-bug 2 (resumed)`) whose spawn request carries
  `resume: { sessionId }` and `cwdOverride` = the cwd from the exit event. The
  YOLO tab stays open (log and PR links remain readable). The button disables
  after one click — one resume tab per run.
- **Closing a running YOLO tab** sends `YOLO.kill` (tree-kill on Windows).

`NewSessionMenu` is unchanged except the YOLO entry is disabled for tools
without a `headless` block.

## Command-line launch

`seniordev PROJ-123 --yolo fix-bug` works unchanged. `startStartupSession`
(`RightPanel.vue`) is the single place mapping `mode: 'yolo'` to a session
start; it now opens a headless YOLO tab via `YOLO.start` instead of a PTY tab
with `yolo: true`. `--prompt` (ad-hoc text) and `--tool` compose exactly as
today.

## Error handling

- **Spawn failure** (missing binary): `YOLO.start` returns `{ok: false, error}`;
  the tab renders the error in the log area and goes straight to exited state.
  No resume offered.
- **Non-zero exit**: status shows the code; Resume still offered if a session id
  was captured — a failed run is precisely when you want to jump in.
- **Malformed stream lines** (partial JSON at chunk boundaries, stdout noise):
  passed through as raw log lines; never lost, never fatal.
- **stderr**: streamed into the same log.
- **No session id captured** (old CLI, `text` parser without a pattern match):
  run completes normally; footer shows the muted unavailable note.
- **Resume spawn failure** (session file gone, CLI updated between run and
  click): the resume tab is a normal terminal tab, so the CLI's own error text
  renders in the xterm — nothing extra to build.

## Testing

- **Unit (vitest):**
  - Schema: good/bad `headless`/`resumeArgs`/`yoloRecap` configs; configs still
    containing `yoloArgs` load cleanly.
  - Parsers: fixture JSONL per tool → expected log lines + session id + result;
    chunk splits mid-JSON-line; garbage lines pass through.
  - Recap appending: default, config override, empty-string disables.
  - `buildInteractiveLaunch` with `resume`: template expansion, composition
    with `interactiveArgs`.
  - PR collection: multiple URLs, order preserved, duplicates removed.
- **Integration:** the runner spawns a real `node -e` child printing fixture
  JSONL and exits — asserts log events round-trip, session id + exit code
  captured, stdin prompt received by the child. Proves the child-process path
  without real CLIs in CI.
- **Manual (user):** one real claude YOLO run and one real codex YOLO run
  against a live ticket, each producing a real PR, then resuming each.

## Open items (resolved during planning, before implementation)

- Verify exact current flags against installed CLI versions:
  does `claude -p --output-format stream-json` still require `--verbose`; the
  right autonomous-permission flag for print mode; `codex exec --json` event
  shape and session-id location; `codex resume <id>` syntax.
- Confirm the claude stream-json and codex JSONL event schemas from docs (not
  memory) when writing the parser fixtures.
