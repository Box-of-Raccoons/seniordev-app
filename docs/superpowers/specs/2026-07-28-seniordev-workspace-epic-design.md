# SeniorDev Workspace Epic: Design

Status: approved, ready for implementation planning
Date: 2026-07-28
Baseline at time of writing: `develop`, 61 test files / 406 tests passing, clean tree

## 1. Context

SeniorDev v0.3.0 is a prompt-driven CLI-agent terminal multiplexer. You pick Claude Code or
Codex, type a prompt in a composer, and the pane morphs into a live TUI running that agent
over ConPTY.

This epic came out of evaluating T3 Code (github.com/pingdotgg/t3code), an open-source GUI
control plane for coding agents that occupies the same product slot. The evaluation found
several capabilities worth adopting, and several worth deliberately refusing.

The retained ideas are persistence, a real project entity, checked-in project config, and
worktree isolation. The refused idea is the transport and UI model: T3 Code drives agents
over structured protocols (the Claude Agent SDK, `codex app-server`, and ACP for Cursor and
Grok) and renders a chat UI. SeniorDev keeps the pty and the TUI.

## 2. Goals and non-goals

### Goals

1. Conversations survive an app restart and can be resumed.
2. A project is a first-class entity, not a cwd string.
3. Multiple conversations visible side by side, in independently tabbed panes.
4. At a glance, know which tabs are working, idle, blocked on you, done, or failed.
5. Optional per-task git worktree isolation.

### Non-goals

1. Replacing the pty transport. The ConPTY readiness detection in
   `src/main/ipc/terminal-handlers.ts` is load-bearing and stays.
2. Replacing the TUI with a structured chat view.
3. Owning a conversation transcript. Claude Code and Codex each persist their own; SeniorDev
   stores only a pointer.
4. Full-text search across history. This is the main thing the JSON storage choice forecloses,
   and it is accepted.
5. Vertical splits or a general split tree. Columns only.
6. Remote or multi-device access.

### Binding design constraints

`DESIGN.md` and `PRODUCT.md` are the source of truth for anything visual in this epic, and
`CLAUDE.md` requires reading both before UI work. Four of their rules bind directly here, and
an earlier draft of this document violated all four:

1. **State is never conveyed by colour alone.** Pair with text, icon, or shape.
2. **Colours are authored in OKLCH from the `DESIGN.md` frontmatter.** The available state
   colours are green (success), amber (attention / in-progress), and rust (error). Teal is
   reserved by the One Signal Rule for one primary action per surface. There is no blue.
3. **A coloured `border-left` or `border-right` wider than 1px as a stripe accent is an
   absolute ban.** Use a tonal step between planes instead.
4. **`prefers-reduced-motion` is honoured on every animation** with a crossfade or instant
   fallback, and motion ships only when it conveys state.

Target is WCAG 2.1 AA: 4.5:1 for body text, 3:1 for large or bold text, a visible focus state
on every interactive element, and full keyboard operability.

## 3. Slices and build order

Ordering is value-first: every slice ships something usable on its own.

| Slice | Name | Depends on |
| --- | --- | --- |
| S1 | Status system | none |
| S2 | Split panes and tab dragging | none |
| S3 | Persistence and project entity | none |
| S4 | Projects sidebar | S3 |
| S5 | Worktree toggle | S3 |

S1 and S2 do not collide despite both touching tabs. Status is main-process state keyed by
`ptyId`, which `src/main/terminal/manager.ts` already uses as its map key. Panes are pure
renderer layout. A tab dragged between panes keeps its `ptyId`, so its status follows it.

Two ordering constraints:

- `LiveTab` carries a `conversationId` from S2 onward, even though nothing persists it until
  S3. This prevents S2's tab model from needing rework.
- Auto-closing a cleanly exited TUI tab is an **S3** deliverable, not S1. Auto-close is only
  safe because the conversation survives in the sidebar. Shipping it in S1 would make a clean
  `/exit` destroy the tab with nothing to resume, which is worse than current behaviour.

## 4. Data model

### 4.1 Persisted

Three JSON files in the existing config directory resolved by `src/main/config/paths.ts`
(`~/.config/SeniorDev` on macOS and Linux, `%APPDATA%\SeniorDev` on Windows), alongside the
current `recent-folders.json`.

**`projects.json`**

```
{ version: 1, projects: [ {
  id, title, path, defaultTool, worktreeDefault,
  lastActiveAt, archivedAt, createdAt, updatedAt
} ] }
```

**`conversations.json`**

```
{ version: 1, conversations: [ {
  id, projectId, title, tool, agentSessionId,
  cwd, worktreePath, branch,
  lastActiveAt, createdAt, archivedAt
} ] }
```

**`workspace.json`**

```
{ version: 1, windowBounds, sidebarWidth, sidebarCollapsed,
  panes: [ { id, widthFraction, tabs: [conversationId], activeTabId } ] }
```

Split by write frequency. `workspace.json` is written on every tab move and pane resize;
`projects.json` changes rarely. One combined file would rewrite the project list on every drag.

### 4.2 Runtime only

```
LiveTab { ptyId, conversationId, paneId, status }
```

Status is never persisted. After a restart nothing is running, so no conversation has a status
until it is reopened.

### 4.3 Deliberately not stored

Git identity (remote, branch, repo root) is resolved live by shelling `git -C <path>` with a
roughly 60 second cache, adopted from T3 Code's `RepositoryIdentityResolver`. There is no
stored git state to go stale.

### 4.4 Storage mechanics

- JSON, not SQLite. Rationale: avoids a second native module alongside `node-pty` and the
  `electron-rebuild` burden it carries; scale is tens to low hundreds of conversations;
  `src/main/recent-folders.ts` is already the exact pattern.
- Atomic writes via tmp plus rename, best-effort and wrapped so a locked directory can never
  fail the launch, exactly as `recordRecent` does today.
- Debounced roughly 500ms.
- `version: 1` with a migrate-on-read function.
- IDs from `crypto.randomUUID()`. Today's `t${counter}-${Date.now()}` is fine for ephemeral
  tabs but collides across restarts.
- No multi-writer concurrency to solve: `src/main/index.ts` already holds a single-instance lock.
- On first run, seed `projects.json` from the existing `recent-folders.json` so the sidebar is
  not empty on day one.

### 4.5 Projects

Projects are auto-created. Launching into any folder with no matching project creates one
silently, titled from the directory basename. This matches T3 Code's `autoBootstrapProjectFromCwd`
and preserves the current composer flow exactly.

Archiving keeps that from becoming clutter:

- `archiveAfterDays` in `config.yaml`, default 14, `0` disables.
- Runs at startup and once daily.
- Never archives a project that has a live tab.
- Fully reversible, and never deletes anything.
- Archived projects live in a collapsed `Archived (n)` section.

### 4.6 Conversation retention

All conversation data is kept. Display is capped instead: 5 per project, then "show more"
reveals 10, then "show all" reveals everything.

## 5. S1: Status system

### 5.1 States

| State | Glyph | Colour | Trigger | OS notification |
| --- | --- | --- | --- | --- |
| working | half-filled circle | amber | any pty data | no |
| idle | filled circle | ink-muted | quiet 700ms, buffer scan finds no prompt | no |
| needsYou | filled triangle, pulsing | amber | quiet 700ms, buffer scan matches a prompt | yes |
| needsReview | filled diamond | green | headless tab exits 0 | yes |
| failed | cross | rust | any non-zero exit | no |
| (no live tab) | none | n/a | no pty for this conversation | n/a |

Every state carries a distinct silhouette. Colour reinforces the state; it never
carries it alone. This is required by `DESIGN.md` section 2 (The Color-Is-State Rule) and
`PRODUCT.md` under Accessibility, both of which name a running versus finished session as the
example case.

Colour assignments follow the documented semantics of the palette rather than convention
imported from elsewhere:

- **amber** is "warning / in-progress attention", so it covers both working and needsYou. The
  two are separated by glyph and motion, not hue.
- **ink-muted** is neutral, which is the honest reading of an interactive session sitting at a
  prompt. Green is reserved for success and an idle session has not succeeded at anything.
- **green** is success only, which a completed headless run is.
- **rust** is errors only.
- **teal is not available.** The One Signal Rule reserves it for the single primary action per
  surface. There is no blue in the palette at all.

Glyphs are drawn as inline SVG rather than font characters, since the app ships on both Windows
and macOS and font glyph rendering differs between them.

**Motion.** Only needsYou pulses, at roughly 1.4s. Motion is permitted here because it conveys
state, which both design documents sanction, but under `prefers-reduced-motion` the pulse is
replaced by a static, heavier glyph. The state must remain fully readable with all animation
disabled.

### 5.2 Transitions

```
spawn                        -> working
working  --quiet 700ms-->    scan -> idle | needsYou
idle | needsYou --pty data-> working
any --pty:exit-->            needsReview | failed | auto-close
```

Exit resolution, using the existing `kind` discriminator and exit code:

| Tab kind | Exit 0 | Exit non-zero |
| --- | --- | --- |
| headless (YOLO) | needsReview, keep the tab | failed, keep the tab |
| interactive (terminal) | auto-close the tab (S3) | failed, keep the tab |

The distinction matters: a headless run exiting 0 means the work finished and is waiting for
review, which is the case the user walked away from. A TUI exiting 0 means the user typed
`/exit` and there is nothing to look at.

### 5.3 Required refactor

`waitForQuiet` in `src/main/ipc/terminal-handlers.ts` is currently one-shot and is torn down by
`cancelPendingPrompt` once prompt delivery sends its Enter. Status needs the same signal
continuously.

Extract the activity tracking (`sawData` / `lastData` per session, fed from the existing
`onData`) into `src/main/terminal/activity.ts`, with two subscribers:

1. prompt delivery, one-shot, behaviour unchanged
2. the status monitor, continuous

One source of truth for "quiet". Two interval timers watching one session and disagreeing is
the failure mode being designed out.

This is the riskiest part of S1. The prompt-delivery timing is tuned against real ink and
ConPTY behaviour and is documented in comments at `terminal-handlers.ts:15-27`. The mitigation
is that `waitForQuiet` semantics do not change, only where the activity data lives.

### 5.4 Prompt detection

Quiet detection lives in main; the buffer scan lives in the renderer. On quiet, main asks the
renderer to scan the last N lines of the xterm buffer and reply. One IPC round trip per quiet
event, roughly once per agent turn.

The renderer matches against xterm's parsed buffer rather than the raw byte stream, so ANSI
sequences and ConPTY chunking are already resolved by the time matching happens.

Patterns live beside `resumeArgs` and `headless.args` in `CLI_PRESETS`
(`src/main/config/presets.ts`) as `approvalPatterns: string[]`, with shipped defaults and
`config.yaml` override. When either vendor reshuffles its TUI, this is a config edit rather
than a release.

### 5.5 Notification rules

- Fire only on transition **into** `needsYou` or `needsReview`.
- Suppress when that tab is active in the focused pane and the window has focus.
- Never re-fire for the same state without an intervening transition.
- Electron's native notification support; no new dependency.

Open concern: multiple simultaneous pulses are untested. If three tabs block at once, three
out-of-phase pulses may be worse than one. Possible mitigation is pulsing only the
highest-priority tab, or pulsing only in the sidebar.

### 5.6 Testability

The state machine and activity tracker are pure main-process logic, testable through the
existing injectable `PtySpawner` seam. The architectural constraint at
`src/main/terminal/node-pty-spawner.ts:5` ("the ONLY module that imports the native node-pty,
never import this from a test") is preserved. The buffer scan is renderer-side and testable
against a fake buffer.

## 6. S2: Split panes and tabs

### 6.1 Model

```
Pane     { id, widthFraction, tabs: LiveTab[], activeTabId }
LiveTab  { ptyId, conversationId, title, kind, tool, status }
```

`widthFraction` rather than pixels, so proportions survive a window resize.

### 6.2 Behaviour

- Columns only. No vertical splits, no nested grid.
- New panes are created by an explicit split control **and** by dragging a tab to the window edge.
- `minPaneWidth` is configurable in `config.yaml`, default 320.
- Split sizing distributes space equally across all panes.
- No hard pane cap; the minimum width implies one.
- Pane resize drives the xterm fit addon and pushes `pty:resize` on the existing channel.

For reference, VS Code hardcodes a roughly 329px minimum editor group width with no cap on
group count. Making the minimum configurable is their single most-requested change in this area
(microsoft/vscode issues #271713 and #54470), which is why it is a config key here.

### 6.3 Preserving scrollback across a drag

Moving a component between parents in a `v-for` causes Vue to unmount and remount it, which
would destroy the xterm instance and its buffer.

Approach: keep every `TerminalView` mounted in one flat list and `<Teleport>` each into its
pane's slot. Moving a tab changes the teleport target rather than the component's position in
the tree. xterm's `.open()` is not reliably re-entrant, so remounting into a new element is not
a viable alternative.

This was spiked on 2026-07-28 (see section 10.1). The mechanism holds.

### 6.4 Refactor

Extract the tab and pane model from `RightPanel.vue` into a `usePanes` composable, testable
without mounting a component, leaving `RightPanel.vue` as layout. This keeps the existing
`RightPanel.test.ts` assertions meaningful rather than rewritten wholesale.

## 7. S3: Persistence and session identity

### 7.1 Acquiring a session id

The two agents differ, and both were verified on this machine on 2026-07-28.

**Claude Code: pre-assign.** `claude 2.1.212` exposes:

```
--session-id <uuid>   Use a specific session ID for the conversation (must be a valid UUID)
-r, --resume [value]  Resume a conversation by session ID, or open interactive picker
--fork-session        When resuming, create a new session ID instead of reusing the original
```

SeniorDev mints a UUID, passes `--session-id` at spawn, and stores it. No discovery step. This
works identically for interactive and headless launches, which collapses two code paths into
one and makes the `sessionId ??= ev.id` scrape at `src/main/headless/runner.ts:55` redundant.

**Codex: post-discover.** `codex-cli 0.146.0` has no launch-time flag to set a session id or
name. It stores sessions in SQLite at `~/.codex/state_5.sqlite`, table `threads`, with columns
including `id`, `cwd`, `created_at_ms`, `name`, `title`, `first_user_message`, `git_branch`,
`archived`.

After spawning codex in a known cwd at a known time, SeniorDev finds the row by filtering on
`cwd` and a creation-time window it controls. This is not mtime guesswork: SeniorDev is the
process doing the spawning, so a collision would require two codex sessions starting in the
same directory inside the same few hundred milliseconds.

Codex session ids are UUIDv7, and the embedded timestamp was verified to be bit-identical to
`created_at_ms`. Therefore the time filter should decode the id itself rather than read the
column. That survives a column rename, which the `state_5` / `logs_2` / `goals_1` version
suffixes suggest is likely.

Resume invocations are already present at `src/main/config/presets.ts:14` and `:32`:

```
claude: resumeArgs: ['--resume', '{{sessionId}}']
codex:  resumeArgs: ['resume', '{{sessionId}}']
```

**Required robustness for the Codex path.** A missing file, a missing `threads` table, an
unexpected schema, or a poll timeout must all resolve to "no resume available for this
conversation" and never to an error. Read-only access only; the database is in WAL mode and
concurrent reads are safe.

**Poll rather than query once.** It is not established whether the `threads` row is written at
spawn or at first user message. Polling with a short backoff and a few-second timeout is
correct under either answer. See section 10.2.

### 7.2 Auto-close

Interactive tabs exiting 0 close automatically, because the conversation survives in the
sidebar and remains resumable. This lands in S3 rather than S1 for the reason in section 3.

## 8. S4: Projects sidebar

- Projects sorted by `lastActiveAt` descending, each expanding to its conversations.
- Conversation display capped 5, then 10, then all.
- Open rows are marked with a **tonal step**: the row lifts one plane, from `bg` to `surface-2`,
  exactly as an active tab already does. No border stripe. `DESIGN.md` section 6 bans a coloured
  `border-left` or `border-right` wider than 1px as a stripe accent, and the Tone-First Rule
  says to reach for a lighter plane before a border. A 1px hairline was evaluated alongside the
  tonal step and was not perceptibly different, so it is omitted; it stays available for the
  selected-row state, which needs its own distinct treatment.
- The status glyph is a separate signal from the tonal step, so "is it open" and "what is it
  doing" never compete for the same mark.
- A conversation with no live tab shows no dot and a dimmed row.
- `Archived (n)` sits collapsed at the bottom; archived projects can be restored.
- Clicking a conversation that has a live tab focuses that tab wherever it lives, including in
  another pane.
- Clicking a conversation with no live tab resumes it, spawning a pty with the tool's
  `resumeArgs` into the **leftmost** pane. Leftmost rather than focused, because focus is
  invisible state and "it opened where I was not looking" is a real failure mode.
- Sidebar rows can be dragged into a specific pane, reusing S2's drag machinery.
- Sidebar is collapsible; its width persists in `workspace.json`.

## 9. S5: Worktree toggle

- A checkbox in the composer beside the folder picker: "run in a new worktree".
- Default off. `Project.worktreeDefault` remembers the last choice per project.
- Disabled with a visible reason when the folder is not a git repository.
- On launch: `git -C <project.path> worktree add -b <branch> <worktreePath> HEAD`, with
  `worktreePath` under `<configDir>/worktrees/<repo>/<branch>`.
- Branch name is prefilled as a slug of the prompt and is editable before launch, prefixed with
  the repo's `branchPrefix`. Note that `branchPrefix` already exists in `RepoSchema`
  (`src/main/config/schema.ts:35-40`) and currently has no consumer anywhere in the launch
  path; this is its first one.
- The conversation records `worktreePath` and `branch`.

**Teardown is manual only.** Archiving or deleting a conversation offers to remove its
worktree, behind a confirm, and reports failure rather than swallowing it. Nothing is removed
automatically. Accumulating stale worktrees is preferable to destroying an uncommitted diff.
T3 Code takes the same position: client-driven removal on delete, a toast on failure, and no
server-side garbage collection.

Basing off a fetched remote tracking branch (T3 Code's `startFromOrigin`) is deferred. It adds
a network call and its own failure modes.

## 10. Risks and open items

### 10.1 Teleport and xterm spike: green, with a gap

Spiked 2026-07-28 in a throwaway vitest file, since deleted. Results:

```
Teleport target change relocates without unmounting   mounts 1, unmounts 0, buffer intact
CONTROL: keyed remount DOES destroy the instance      mounts 2, unmounts 1
REAL XTERM: buffer survived a DOM move                initialised true, survived true
```

The control matters: the first version of it was wrong and passed vacuously, because Vue
diffed two unkeyed sibling branches as the same element and reused the child. Keys were
required to make it a real control.

Two limits. xterm only initialised after stubbing `matchMedia`, which jsdom lacks, and jsdom
cannot measure text, so **fit and dimension recalculation after a move is untested**. The two
halves were also tested separately: Vue Teleport in one test, a raw `appendChild` of an xterm
node in another, never composed.

**Action: open S2 with a short check in the real Electron app before starting the drag work.**

### 10.2 Codex row timing: unverified

Whether the `threads` row appears at spawn or at first user message is not established.
`updated_at_ms` was 3.7 seconds after `created_at_ms` on the observed row, which is suggestive
but not proof. The polling design in section 7.1 is correct under either answer, so this does
not block implementation.

To settle it: start a codex session and do not type anything. If a row appears, it is created
at spawn.

### 10.3 Undocumented dependency on Codex internals

Reading `~/.codex/state_5.sqlite` is an internal contract with no stability guarantee. The
version suffixes on the filenames indicate the schema does change. Mitigated by decoding the
UUIDv7 timestamp rather than trusting column names, and by degrading to no-resume on any
mismatch.

### 10.4 Multiple simultaneous pulses

Untested. May need a "loudest one only" rule. See section 5.5.

### 10.5 Behaviour gap between S1 and S3

Between S1 and S3 shipping, a cleanly exited TUI tab shows a static failed-style dot and must
be closed by hand, as it is today. This is intentional.

## 11. Verification baseline

Recorded 2026-07-28 on `develop` with a clean tree, before any implementation:

```
Test Files  61 passed (61)
     Tests  406 passed (406)
```

Commands: `pnpm test` (vitest run), typecheck via
`vue-tsc --noEmit -p tsconfig.web.json && tsc --noEmit -p tsconfig.node.json`.

Every slice re-runs the full suite and reports the delta against these numbers.

## 12. Evidence log

Claims in this document that were confirmed by direct observation rather than inference:

| Claim | How confirmed |
| --- | --- |
| `claude --session-id <uuid>` exists | `claude --help` on 2.1.212, this machine |
| Codex has no launch-time session id flag | `codex --help`, `codex resume --help`, `codex exec --help` on 0.146.0 |
| Codex `threads` schema | `sqlite3` read-only query against `~/.codex/state_5.sqlite` |
| Codex ids are UUIDv7 with a matching timestamp | Decoded `019fabb7-e368-7140-a9db-612c8f6198a1`, bit-identical to `created_at_ms` 1785292383080 |
| Teleport preserves the component instance | Spike test run, results in 10.1 |
| SeniorDev has no session persistence today | Only four files in `src/` write to disk: `config-handlers.ts`, `prompts/files.ts`, `prompts/defaults.ts`, `recent-folders.ts` |
| SeniorDev has no sidebar today | `App.vue:76` renders `<RightPanel>` as the entire shell; no renderer file matches `Sidebar` or `LeftPanel` |
| `branchPrefix` has no consumer | Grep of the terminal and session launch path |
| Test baseline | `npx vitest run`, full suite |
| VS Code has no editor group cap | microsoft/vscode issue #190642, open feature request |
| The status vocabulary must not rely on colour | `DESIGN.md` section 2 Color-Is-State Rule; `PRODUCT.md` Accessibility |
| No blue exists in the palette; teal is reserved | `DESIGN.md` frontmatter colours plus the One Signal Rule |
| A >1px coloured side border is banned | `DESIGN.md` section 6, Don't list |
| A 1px hairline adds nothing over the tonal step | Rendered both side by side; not perceptibly different |

Claims carried as inference, not confirmed:

- That making `waitForQuiet` continuous will not disturb prompt-delivery timing. The refactor
  preserves semantics, but the timing is empirically tuned and only a real run proves it.
- That the buffer-scan approach will reliably distinguish a permission prompt from ordinary
  quiet output across both CLIs and future versions of them. This is why the patterns are
  configuration rather than code.
