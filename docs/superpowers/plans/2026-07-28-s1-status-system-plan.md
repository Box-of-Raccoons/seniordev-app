# S1 Implementation Plan: Status System

Slice 1 of the workspace epic. Design source of truth:
`docs/superpowers/specs/2026-07-28-seniordev-workspace-epic-design.md`.

Stakes: medium blast, mostly reversible. Step 1 touches empirically tuned ConPTY timing and is
the entire risk of this slice. Everything after it is additive.

**Read before starting:** the spec above, plus `DESIGN.md` and `PRODUCT.md` (required by
`CLAUDE.md` before any UI work). Step 6 is design-system bound and an earlier draft of the spec
violated four of their rules.

## 1. Grounding findings

These were established by reading the files closely on 2026-07-28. They are the expensive part
of this plan: each one is a subtlety that a fresh read will skim past, and each one changes the
design. All three are **confirmed by reading the code**, not inferred.

### 1.1 `waitForQuiet` cannot simply be shared

`src/main/ipc/terminal-handlers.ts:62` does `pendingPrompts.set(id, { sawData: false, lastData: 0 })`
on **every** call, and `:69` deletes the entry once the session settles.

Consequences:

- The activity window only exists **while a prompt delivery is pending**. It is not a
  general-purpose record of session activity.
- The reset to `sawData: false` is deliberate. Each delivery phase waits for **new** output
  after the call, which is what makes the codex bracketed-paste double-wait at `:86` correct.

A continuous status monitor wants the opposite: activity retained for the life of the session.

**Therefore:** the extracted tracker holds `{ sawData, lastData }` per session for the whole
session lifetime, updated on every data event and cleared only on exit. Each consumer registers
a *watch* that captures its own start mark and resolves when data arrived after that mark and
then went quiet for its own interval. This reproduces prompt-delivery semantics exactly while
letting status poll independently.

Getting this wrong breaks prompt delivery silently, and the test suite will not catch it,
because the suite cannot exercise ConPTY timing. See step 1's gate.

### 1.2 There are two event sources, not one

YOLO (headless) tabs never touch `TerminalManager`. They run through `src/main/headless/runner.ts`,
render in `YoloView.vue`, and are torn down by a separate `yolo?.killAll()` in
`src/main/index.ts`. They emit on the `YOLO` channels, not `TERM`.

**Therefore:** `working` for a headless tab comes from `yolo:log`, and `needsReview` / `failed`
come from `yolo:exit`. Only interactive and shell tabs go through the pty path and the buffer
scan. The state machine must accept both sources. The spec's transition diagram describes the
pty path only.

### 1.3 The renderer seam for the buffer scan

In `src/renderer/src/components/TerminalView.vue`, `term` is a `let` local to `setup` and is not
exposed. The component already filters main-process events by its own id at `:67` and `:73`.

**Therefore:** the scan listener belongs in `TerminalView.vue`, filtered by `props.id`, mirroring
that existing pattern. Do not build a renderer-wide registry of terminal instances; the
component-local pattern already in use is sufficient and consistent.

Read the buffer via `term.buffer.active`, starting at `baseY` for `term.rows` lines.

## 2. Steps and gates

Each step is independently verifiable. Do not proceed past a red gate.

**Step 1. Extract `src/main/terminal/activity.ts`.**
Per-session activity fed from the existing `onData` callback at `terminal-handlers.ts:46`, plus
a watch API per 1.1. Rewrite `waitForQuiet` as a thin caller over it. No behaviour change
intended.
*Gate:* unit tests for the tracker, full suite against baseline, **and a manual launch of both
CLIs**. Spawn claude and confirm the seeded prompt still submits rather than sitting in the
composer. Spawn codex with a multi-line prompt and confirm the bracketed-paste path still
submits after the paste settles. The suite passing is necessary and not sufficient here.

**Step 2. `src/main/terminal/status.ts`.**
Pure state machine over `{ data, quiet, exit(code), kind, source }` producing the five states.
No IPC, no Electron imports.
*Gate:* unit tests covering every cell of the exit 2x2 in spec section 5.2, from both event
sources.

**Step 3. IPC surface.**
Add a `STATUS` channel group to `src/shared/ipc.ts` alongside `TERM` (`:36`), with its event
types, and bridge it in `src/preload/index.ts`.
*Gate:* typecheck.

**Step 4. Buffer scan.**
A pure matcher module plus the id-filtered listener in `TerminalView.vue` per 1.3. Includes a
temporary debug path that dumps the scanned buffer text to a file, used to capture real samples
(see section 5).
*Gate:* unit tests for the matcher against **captured** text, not invented text.

**Step 5. `approvalPatterns` config.**
Add to `CLI_PRESETS` in `src/main/config/presets.ts` and to `CliToolSchema` in
`src/main/config/schema.ts`, which currently ends at `resumeArgs` on `:26`.
*Gate:* config tests, including that an absent key degrades to no prompt detection rather than
throwing.

**Step 6. Renderer rendering.**
SVG glyph component for the five states, `prefers-reduced-motion` fallback, wired into the tab
strip and driven by the status channel. Palette and glyph vocabulary are fixed by spec section
5.1; do not substitute colours.
*Gate:* component tests, plus a real look in the running app. This is the design-system bound
step.

**Step 7. Notifications.**
Electron `Notification` on transition into `needsYou` or `needsReview`. Extract the
should-notify predicate as a pure function.
*Gate:* unit tests on the predicate, covering the focused-tab suppression and the no-refire rule.

Suggested order: 1, 2, 3, then 4 and 5 together, then 6, then 7.

## 3. Resolved decisions

- **Shell tabs get all five states**, scanned with the union of all configured
  `approvalPatterns`. No process detection. If a user launches claude inside a raw Terminal tab
  and it asks for permission, the pattern matches and the state fires.
- **Quiet detection lives in main, the scan lives in the renderer.** One IPC round trip per
  quiet event, roughly once per agent turn. The alternative, duplicating quiet detection in the
  renderer, was rejected: the timing logic is tuned and should exist once.
- **The config key is `approvalPatterns`.** It was briefly called `promptPatterns`, which
  collides with the seeded role prompt library in `~/.config/SeniorDev/prompts/`
  (`business-analyst`, `orchestrator`, `senior-dev` and five others). Those are unrelated.
- **Auto-close on a clean interactive exit is not in this slice.** It is S3, per spec section 3.
  Until then a cleanly exited TUI tab is closed by hand, as today.

## 4. Dead ends, do not repeat

- **Extracting approval strings from the claude binary does not work.** `claude` at
  `~/.local/share/claude/versions/2.1.212` is a 233MB compiled Mach-O, not a readable JS bundle.
  Two `strings` passes (`-n 6` and `-n 8`) over the whole binary matched nothing; the payload is
  compressed. Roughly twenty minutes spent, no result.
- **Detecting which program a shell tab is running was considered and dropped.** node-pty
  exposes a child pid and POSIX can read the tty foreground process group, but this was never
  verified and ConPTY makes it unreliable on Windows. The pattern union in section 3 achieves
  the same outcome with no platform-specific code.

## 5. Must be measured, not assumed

- **The approval patterns themselves.** Capture them from the rendered xterm buffer using the
  debug path in step 4, then write patterns against that exact text. Do not write patterns from
  a copy-paste, from documentation, or from reasoning. What the scanner sees is the rendered
  buffer with wrapping and box drawing already resolved, and a sample from any other source can
  disagree with it.
- **That step 1 preserves prompt-delivery timing.** The refactor is semantics-preserving by
  construction, which is an argument, not evidence. Only the manual launch proves it.
- **That reading `term.buffer.active` on every quiet event is cheap enough.** Inferred from it
  being a synchronous in-memory read of roughly 24 lines. Not measured. If the app stutters with
  many tabs open, measure here first.

## 6. Baseline

Recorded on `develop` with a clean tree before any implementation:

```
Test Files  61 passed (61)
     Tests  406 passed (406)
```

`pnpm test` (vitest run); typecheck via
`vue-tsc --noEmit -p tsconfig.web.json && tsc --noEmit -p tsconfig.node.json`.

Every step reports its result as a delta against these numbers, naming any test that changed
state and why.
