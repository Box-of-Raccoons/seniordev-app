# SeniorDevWatch — Jira-polling tray dispatcher

Date: 2026-07-03
Status: approved (design sections confirmed by user)

## Summary

A headless Electron **system-tray process** (no window) in the `seniordev-app`
repo that polls Jira on a configurable interval for the user's tickets tagged
`SeniorDev` and drives each new ticket through a shared **Jira Orchestrator**
(classify → YOLO spawn), one at a time. A tray-menu checkbox toggles between
**auto-dispatch** and **approve-first**, defaulting to approve.

Unlike the bookmarklet/`seniordev://` approach in
`2026-07-03-jira-trigger-design.md` (a per-click, human-initiated trigger with a
non-optional in-app confirm gate), SeniorDevWatch is a *trusted local poller*:
the security rationale for a hard per-run gate does not apply the same way, so
confirmation becomes a user-configurable convenience rather than a fixed barrier.
The two features are complementary and **share one orchestrator module**.

## Decisions made during brainstorming

- **The watcher runs the orchestrator itself** and spawns the CLI (e.g. claude)
  directly — it does not go through the Electron app UI or a `seniordev://` deep
  link. Most self-contained; truly headless.
- **Same repo, new package/entry.** Lives in `seniordev-app` and imports the
  existing headless spawner, parsers, prompt library, jira, and config code — no
  duplication, one test suite, one build.
- **Autonomy is configurable** via a tray-menu checkbox: full-auto vs.
  approve-first. **Defaults to approve-first.**
- **JQL scope:** `assignee = currentUser() AND labels = "SeniorDev"`, plus a
  status-category guard (below) for dedup.
- **Dedup by status transition:** after a *successful stage-2 spawn* the watcher
  transitions the ticket out of the trigger status (e.g. To Do → In Progress) so
  it leaves the query, backed by a **local state file** as a safety net.
- **Sequential FIFO queue** — one orchestrator run at a time.
- **Runtime: headless Electron** — a second electron-vite build target that
  creates only a `Tray` (no `BrowserWindow`), reusing node-pty spawning, native
  Notifications, and the single-instance lock.

## Preconditions (now built on develop @ f75b7fc)

The Jira Orchestrator and `seniordev://` handler from
`2026-07-03-jira-trigger-design.md` **landed on `develop`** (PR #3, merge
`f75b7fc`) while this design was being drafted; `feature/seniordev-watch` is
rebased onto that merge. The relevant existing code:

- `src/main/orchestrator/catalog.ts` — `buildCatalog(prompts)` (pure).
- `src/main/orchestrator/extract.ts` — `extractVerdict(output)` (pure).
- `src/main/ipc/orchestrator-handlers.ts` — `registerOrchestratorIpc`, holding a
  **private** `finalize()` (never-guess-and-run result logic) and an inline
  stage-1 classify build, bound to `ipcMain` + `getSender()`.
- `src/renderer/src/components/OrchestratorView.vue` — the **classify→spawn
  sequencing** (calls `classify`, then mounts `YoloView` on success). This lives
  in the renderer, so a headless tray cannot reuse it.
- `JiraClient` still only exposes `fetchIssue(key)` — no JQL search or
  transitions.

This design therefore **consumes** the orchestrator and adds a small
renderer-agnostic extraction (§1) that both the existing IPC handler and the new
tray share, plus JQL/transition methods on `JiraClient`.

## 1. Architecture & components

All new code lives in this repo and reuses existing plumbing.

- **`src/watch/main.ts`** — the tray entry, a *second* electron-vite build
  target. Creates a `Tray` + context menu, **no `BrowserWindow`**. Acquires its
  own `requestSingleInstanceLock`. Owns the poll timer, the queue, and tray
  state. Deliberately thin — orchestration logic lives in the tested modules
  below.
- **`src/main/orchestrator/run.ts`** *(new — the extraction)* — pulls the
  renderer-agnostic classify machinery out of `orchestrator-handlers.ts` so both
  the IPC handler and the tray share one code path:
  - `finalize(exitCode, buffer, prompts): ClassifyResult` — moved out of the
    handler and **exported** (the never-guess-and-run logic; now unit-testable).
  - `buildClassifyLaunch(config, source, promptsDir, req)` — the async stage-1
    build (readOrchestratorFile → getTicket → `buildPromptTicket('both')` →
    `resolveForge` → `expandPrompt` with `buildCatalog` → `buildHeadlessLaunch`
    with **`bare:true`** so no `yoloPreamble`/`yoloRecap` wraps the classifier).
  - `createClassifyRunner(spawner, onLog)` → `{ classify(req): Promise<ClassifyResult>; kill(id) }`
    — owns a `YoloRunner`, buffers stdout per id, and resolves via `finalize`.
  `orchestrator-handlers.ts` is refactored to call these (behavior-preserving;
  its existing behavior and tests stay green). **Stage 2 (spawn)** needs no new
  module: on `ok`, the tray composes the existing `resolveExpandedPrompt` +
  `buildHeadlessLaunch` (non-bare, so preamble/recap apply) + `YoloRunner` +
  `buildForgePatterns` — the same pieces `yolo-handlers.ts` uses. The
  orchestrator's own prompt remains the `presets.ts`/`_jira-orchestrator.md`
  built-in and never appears in its own catalog.
- **`src/main/jira/client.ts`** — extend with:
  - `search(jql): Promise<Ticket[]>` → **`POST /rest/api/3/search/jql`** (the
    current enhanced-search endpoint; the old `GET /rest/api/3/search` is
    deprecated — verify against the live instance at build time, using the same
    `FIELDS` and reusing `normalizeIssue` per issue).
  - `getTransitions(key)` and `transition(key, transitionName)` →
    `GET`/`POST /rest/api/3/issue/{key}/transitions` (resolve the transition id
    by name, case-insensitive; a missing name is a distinguishable "not found").
  The existing `fetchIssue` and `authHeader` are untouched. Same fake-`fetch`
  test style as `client.test.ts`.
- **`src/watch/` pure modules** (each unit-tested in isolation):
  - `jql.ts` — build the query string from `watch` config.
  - `state.ts` — read/write the dedup state file (dispatched keys + timestamps).
  - `repo-map.ts` — map a ticket key's project prefix to a `config.repos[]` entry
    (the run cwd); returns null when no repo matches.
  - `queue.ts` — sequential FIFO runner (one active job; enqueue the rest).

## 2. Data flow (one poll tick)

1. Timer fires → `JiraClient.search(jql)`, where
   `jql = assignee = currentUser() AND labels = "SeniorDev" AND statusCategory = "To Do"`
   (label + trigger-status configurable).
2. For each returned key **not** already in-flight or in the state file → map its
   project key to a repo via `repo-map.ts`. **No repo match → skip + tray
   notify** ("SD-9: no repo configured"); the ticket is not dispatched and not
   recorded (so configuring the repo later picks it up).
3. Enqueue matched tickets. The queue drains **one at a time** (FIFO).
4. Per ticket:
   - **Approve mode (default):** tray `Notification`; the run starts only when
     the user clicks it (or clicks Approve in an on-demand mini-window). Until
     then the ticket stays queued.
   - **Auto mode:** the run starts immediately.
5. On **run start**: orchestrator **stage 1 (classify)**.
6. On a **valid prompt name** → **stage 2 (spawn)** the YOLO run. Only on a
   successful stage-2 spawn does the watcher (a) transition the ticket out of the
   trigger status (To Do → In Progress) so it leaves the query, and (b) record
   the key in the state file (safety net against re-dispatch if the transition
   fails or is misconfigured).
7. On **classifier failure / no-match / nonexistent prompt / `null`** → **no
   stage 2**, **no transition** (ticket stays in To Do so the user sees it),
   tray notify with the reason. The key **is** still written to the state file
   (`outcome: "failed"`) so a classifier that can't route a ticket does not
   re-run every tick (a classify-run storm). Because the ticket keeps the label
   and trigger status, the JQL still returns it, but the state file suppresses
   re-dispatch; **retrying requires clearing that key from the state file** (a
   future "Retry failed" tray action is a candidate). (Confirmed behavior: don't
   transition on failure.)
8. On **run end** → tray notify with outcome: PR link if the parser detected one,
   otherwise the failure summary.

## 3. Config

A new `watch:` block in the same `config.yaml`
(`%APPDATA%\SeniorDev\config.yaml` on Windows). All existing config (jira creds,
`repos`, `cliTools`, prompts, `yoloPreamble`/`yoloRecap`) is reused as-is.

```yaml
watch:
  enabled: true
  intervalSeconds: 300              # the supplied polling interval
  label: SeniorDev                  # the trigger label
  triggerStatusCategory: "To Do"    # only tickets in this category are picked up
  transitionOnDispatch: "In Progress"  # transition name, matched via getTransitions;
                                        # if not found, notify and proceed with the run
  autoMode: false                   # INITIAL default only; the tray checkbox's
                                    # runtime value is persisted to watch-state.json
```

Validated by extending `ConfigSchema` with `watch: WatchSchema.default({})` (all
fields defaulted; `enabled` defaults false, so an absent block = watcher
disabled). The tray checkbox does **not** rewrite `config.yaml` — that file has
user comments a `parse`/`stringify` round-trip would drop. Instead the toggle's
value lives in the runtime state file; effective mode on boot =
`state.autoMode ?? config.watch.autoMode`.

State file: `%APPDATA%\SeniorDev\watch-state.json` (next to config), holding
`{ autoMode?: boolean, dispatched: { "SD-6": { at: "<iso>", outcome: "spawned|failed" } } }`.
Written atomically (tmp + rename, like `writeAtomic` in `prompts/files.ts`).

## 4. Tray UX

Tray icon + tooltip reflect state: idle / polling / running N / error. Context
menu:

- **☑ Auto-dispatch** — the auto/approve toggle (persists to `watch-state.json`).
- **Poll now** — force an immediate tick.
- **Pause / Resume polling**.
- Status line (disabled item): "last poll 14:02 · 1 running · 3 done today".
- **Open config** — reveal `config.yaml` in the editor/explorer.
- **Quit**.

Approve-mode prompts use a native `Notification` with click-to-run. If a richer
confirmation is wanted (showing the ticket summary + chosen repo), the tray opens
a small on-demand window that closes after the decision.

## 5. Error handling & lifecycle

- **Jira poll failure** → error tray state + notify; keep polling (never crash
  the process).
- **Overlapping polls** → if a tick is still resolving when the next fires, skip
  the new tick (single in-flight poll).
- **Transition failure** → notify; proceed with the run anyway (the state file
  still dedups).
- **Missing/invalid config** → tray shows an error state and offers **Open
  config**; no polling until fixed.
- **Single instance** → a second launch of the watcher exits immediately
  (`requestSingleInstanceLock`), independent of the main app's own lock.

## 6. Testing

- Pure modules `jql.ts`, `state.ts`, `repo-map.ts`, `queue.ts` — full unit
  coverage (query strings, dedup add/skip, prefix→repo mapping incl. no-match,
  FIFO ordering + single-active invariant).
- `JiraClient.search` / `getTransitions` / `transition` — fake-`fetch` tests in
  the existing `client.test.ts` style (auth header, URL/JQL shape, error status
  handling).
- `orchestrator/run.ts` — fake-spawner tests for the extraction: `finalize`
  cases (non-zero exit, no verdict, `null`, unknown name, valid), the stage-1
  launch omits preamble/recap (`bare:true`), and `createClassifyRunner` resolves
  correctly. The existing `orchestrator-handlers.ts` behavior stays unchanged
  after refactoring to call `run.ts` (its current tests remain green).
- Tray wiring is thin; covered by a manual smoke checklist (icon appears, toggle
  persists, Poll now works, notification click starts a run).
- All existing tests must remain green against the recorded baseline.

## Acceptance criteria

- With `watch.enabled` and valid creds, the tray process starts, shows an icon,
  and polls every `intervalSeconds`.
- A new ticket matching `assignee = currentUser() AND labels = "SeniorDev" AND
  statusCategory = "<trigger>"` and mapping to a configured repo is dispatched
  through classify→spawn.
- **Approve mode (default):** the run waits for a click; **auto mode:** it runs
  immediately. The tray checkbox flips modes and persists to `watch-state.json`.
- Successful spawn transitions the ticket out of the trigger status and records
  it; the same ticket is never dispatched twice.
- Classifier failure/no-match runs no stage 2, does **not** transition, notifies
  the reason, and (via the state file) does not re-dispatch every tick.
- A ticket with no matching repo is skipped with a notification and picked up
  once a repo is configured.
- Runs execute **one at a time** (FIFO); a batch drains sequentially.
- Jira/transition/config errors surface in the tray without crashing the poller.
- Existing app tests, CLI flows, and the in-app orchestrator/deep-link trigger
  (already on `develop`) are unaffected by the extraction — verified against the
  recorded baseline.

## Out of scope (v1)

- Any change to the `seniordev://` deep-link/protocol handler or the in-app Jira
  trigger beyond the behavior-preserving `run.ts` extraction they now share.
- A packaged installer / OS auto-start for the tray (v1 runs it via a `pnpm`
  script + `electron out/main/watch.js`); installer + login-item is a follow-up.
- Label-removal and Jira-comment audit trails (state-file + status transition
  only).
- Per-tool flag-enforced read-only classifier (`classifyArgs`) — prompt-enforced
  in v1, same caveat as the jira-trigger design.
- Non-Windows tray polish (design targets Windows 11 first; Electron Tray is
  cross-platform but only Windows is verified in v1).
- Parallel / cross-repo concurrent runs (sequential only in v1).

## Known caveats

- The classifier runs with the tool's existing headless flags, so "modify no
  files" is prompt-enforced, not flag-enforced (inherited from the jira-trigger
  design). The approve-first default bounds exposure for cautious users; auto
  mode is an explicit opt-in.
- Dedup correctness in the failure path rests on the local state file; deleting
  `watch-state.json` will re-dispatch previously-failed tickets.
- `transitionOnDispatch` is matched by transition **name** and depends on each
  project's workflow exposing it; a missing transition degrades to "run happens,
  no status change" (with a notification), relying on the state file for dedup.
- `feature/seniordev-watch` is rebased onto `develop @ f75b7fc` (the merged
  orchestrator), so the extraction refactors code that already shipped —
  the plan must keep `orchestrator-handlers.ts` and `OrchestratorView.vue`
  behavior identical and their tests green.
```
