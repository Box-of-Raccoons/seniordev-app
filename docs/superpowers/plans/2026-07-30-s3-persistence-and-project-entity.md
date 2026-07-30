# S3: Persistence and project entity — implementation plan

Status: draft, awaiting approval
Date: 2026-07-30
Branch to create (off `develop`): `feature/s3-persistence`
Baseline: `develop`, clean tree, **520 tests passing** (S1+S2 merged `--no-ff`, not pushed).
Design source: `docs/superpowers/specs/2026-07-28-seniordev-workspace-epic-design.md` §4 (data model), §7 (S3), §3 (ordering), §10.2/10.3 (Codex risks).
Prior slice: `docs/superpowers/plans/2026-07-29-s2-split-panes.md` (S3 persists the pane/tab layout S2 built).
Visual source of truth: `DESIGN.md`, `PRODUCT.md` (only §7.2 auto-close touches anything visible).

Stakes read: **medium-blast, reversible.** All new files + additive config/IPC; no rewrite of the load-bearing pty/readiness path. The one irreversible-ish surface is spawning a `claude` with a pre-assigned `--session-id` (changes argv on every fresh claude launch) — covered by additive tests and a resume-path left untouched.

---

## Evidence confirmed on this machine tonight (2026-07-30)

Everything below was run, not inferred:

| Claim | How confirmed |
| --- | --- |
| `claude 2.1.212`, `--session-id <uuid>` + `-r/--resume` + `--fork-session` all present | `claude --version`, `claude --help` |
| `codex-cli 0.146.0` | `codex --version`; also `cli_version` in a rollout `session_meta` line |
| **`node:sqlite` is NOT in the app runtime** | `ELECTRON_RUN_AS_NODE=1 electron -e "require('node:sqlite')"` → `ERR_UNKNOWN_BUILTIN_MODULE`; Electron 31.7.7 bundles **Node 20.18.0**, `node:sqlite` landed in Node 22.5 |
| `better-sqlite3` not a dependency, and banned by design §4.4 (no 2nd native module) | `package.json` — only `node-pty` native |
| Codex `threads` schema (`id, cwd, created_at_ms, has_user_event, first_user_message, git_branch, archived, name, …`) | `sqlite3 -readonly ~/.codex/state_5.sqlite ".schema threads"` |
| **Codex writes `~/.codex/sessions/YYYY/MM/DD/rollout-<ISO>-<UUID>.jsonl`, UUID in the filename** | `find ~/.codex/sessions` + `rollout_path` column |
| Each rollout file's first line is `session_meta` carrying `session_id`, `cwd`, `cli_version` | `head -1` of a real rollout file |
| **Codex ids are UUIDv7 whose first 48 bits == the timestamp, bit-identical** | decoded `019fac38-7f16-…` → `1785300811542` == `created_at_ms` (MATCH on two real rows) |
| `sqlite3` CLI present on this Mac (`/usr/bin/sqlite3` 3.51.0) but NOT guaranteed on Windows | `which sqlite3` |

---

## Decisions that need your call

### D1 (headline) — Codex id discovery: rollout-file `fs` scan, NOT `state_5.sqlite`

Design §7.1 says read `~/.codex/state_5.sqlite`. Tonight's spike says **don't**, for three independent reasons:

1. **The runtime can't.** No `node:sqlite` in Electron 31's Node 20.18; `better-sqlite3` is banned by §4.4. A pure-JS/WASM reader (`sql.js`) reads only the main db file and **cannot see WAL-resident rows** — and a brand-new thread row (exactly what we poll for) sits in the 3.7 MB WAL, not the main file. Shelling `sqlite3` works on macOS but isn't on stock Windows.
2. **A better contract exists.** Codex writes a per-session `rollout-*.jsonl` whose **filename contains the session UUID**, and whose first line is a self-describing `session_meta` with `session_id` + `cwd`. Discovery becomes: list a directory, decode the UUIDv7 timestamp from the filename, confirm `cwd` from the first line. **Pure `fs`, zero deps, cross-platform, WAL-irrelevant.**
3. **It's more stable.** §10.3 already flags the `state_5`/`logs_2` suffixes as schema churn. The rollout dir layout + `session_meta` shape is the more durable, semi-public contract.

**Recommendation: switch the Codex mechanism to the rollout-file scan.** Same UUIDv7-decode robustness §7.1 asked for, same "any miss → no resume available" degradation, but it actually runs in the shipped app. The alternative (sqlite) loses on all three points above.

This is a deviation from an approved spec, so it's your call. If you approve, I'll also add a one-paragraph correction to the design doc §7.1/§10.3 in the same branch so the record matches.

### D2 — Restart rehydration scope for S3

S3 persists `workspace.json` (panes/tabs-as-conversationIds/geometry). Question: on next launch, does S3 **restore the window bounds + pane geometry only**, or also **re-materialise tabs**? Nothing is running after a restart, so re-materialised tabs would be resume-placeholders — and the natural surface for "click to resume" is the **S4 sidebar**.

**Recommendation:** S3 restores `windowBounds` + `sidebarWidth/collapsed` + pane geometry (empty columns), and **persists** the tab list, but does **not** auto-spawn/resume tabs on boot. Resume-from-storage is S4's job (§8: "clicking a conversation with no live tab resumes it… into the leftmost pane"). This keeps S3's blast radius small and avoids double-owning resume UX. Flag if you'd rather S3 also rebuild tabs on boot.

### D3 — Auto-close scope (§7.2) — DECIDED: agent interactive **and** clean shells

The §5.2 table: interactive agent tab exit 0 → auto-close; headless(YOLO) exit 0 → `needsReview`, keep; any non-zero → `failed`, keep. **Hardy's call (2026-07-30):** auto-close **both** `kind === 'terminal'` (agent) **and** `kind === 'shell'` on exit 0. A shell has no resumable conversation, but a clean `exit` leaves nothing to look at, so closing it is the wanted UX. YOLO exit 0 still → `needsReview` keep; any non-zero still → `failed` keep. This is a deliberate step past the design's "closes because the conversation survives" reasoning for the shell case.

---

## Decisions I'm making (low-blast — stated, not asking)

- **`claude` session id = the tab's `conversationId`.** `usePanes` already mints `conversationId` via `crypto.randomUUID()` (a valid UUID). Reuse it as claude's `--session-id` at spawn: no discovery step, interactive and headless collapse to one path, and the `sessionId ??= ev.id` scrape at `runner.ts:55` becomes redundant for claude (left in place, harmless). For **codex**, `conversationId` ≠ `agentSessionId` (codex assigns its own; we discover it and store it alongside).
- **Persistence lives in the main process** (it owns `fs`), via a small `jsonStore` factory that reproduces `recordRecent`'s contract exactly: atomic `tmp`+`rename`, best-effort (a locked dir never fails launch), `version:1` + migrate-on-read, `~500ms` debounce. The renderer sends layout snapshots over IPC; main debounce-writes.
- **Three files**, split by write frequency exactly as §4.1: `workspace.json` (hot — every move/resize), `conversations.json` (warm — per launch / id capture), `projects.json` (cold — rare). Your brief compressed this to two; `conversations.json` is where `agentSessionId` lives, so it's required for resume.
- **IDs** from `crypto.randomUUID()` (global in Node 20). Projects/conversations keyed by UUID; a project is also deduped by normalised `path`.

---

## Data model (as it will be written)

`~/.config/SeniorDev/` (macOS/Linux) or `%APPDATA%\SeniorDev\` (Windows), beside `recent-folders.json`, dir from `src/main/config/paths.ts`.

```
projects.json       { version:1, projects:[ {id,title,path,defaultTool,worktreeDefault,
                                             lastActiveAt,archivedAt,createdAt,updatedAt} ] }
conversations.json  { version:1, conversations:[ {id,projectId,title,tool,agentSessionId,
                                             cwd,worktreePath,branch,lastActiveAt,createdAt,archivedAt} ] }
workspace.json      { version:1, windowBounds, sidebarWidth, sidebarCollapsed,
                      panes:[ {id,widthFraction,tabs:[conversationId],activeTabId} ] }
```

`worktreePath`/`branch` stay null in S3 (populated by S5). Status is never persisted (§4.2).

---

## Steps (each with its own gate; gates report a delta vs 520)

1. **`jsonStore` factory + `paths` additions (main).** `src/main/store/json-store.ts`: `load(migrate)`, debounced `save`, atomic write, best-effort — the `recordRecent` contract generalised. Path helpers for the three files.
   **Gate:** `json-store.test.ts` (atomic write, corrupt→default, migrate-on-read bumps version, debounce coalesces); typecheck; full suite `520 + N`.

2. **Projects store + auto-create + seed (main).** `projects-store.ts`: `list/get`, `ensureForCwd(path)` (auto-create, basename title, dedupe by normalised path, bump `lastActiveAt`), one-time seed from `recent-folders.json`. IPC: `projects:list`.
   **Gate:** unit tests (auto-create idempotent by path; basename title; seed maps the recent list; `lastActiveAt` bump); suite; typecheck.

3. **Claude pre-assigned `--session-id` (presets + launch + spawn IPC).** Add `sessionIdArgs?: ['--session-id','{{sessionId}}']` to the claude preset + `CliToolSchema`. `buildInteractiveLaunch` injects it on a **fresh** (non-resume) launch when the tool defines it and the spawn request carries a `sessionId`. Plumb `conversationId` → `SpawnTerminalRequest.sessionId`.
   **Gate:** additive `session.test.ts` (fresh claude → `--session-id <uuid>`; resume path unchanged; codex has no `sessionIdArgs` → unaffected); suite; typecheck.

4. **Codex rollout-file discovery (main) — the D1 mechanism.** `src/main/codex/session-discovery.ts`: pure `findRolloutSession({sessionsDir, cwd, since, until}, fs)` → scans `sessions/**/rollout-*.jsonl`, decodes the UUIDv7 ms from each filename, filters to `[since,until]`, confirms `cwd` from the first `session_meta` line, returns the newest match or `null`. Poll wrapper anchored at **prompt submission** (opportunistic until exit for hand-run shells), `~500ms` interval, bounded timeout; **every** miss/malformed/missing → `null` (no resume). Read-only.
   **Gate:** unit tests with fixture rollout files (match by cwd+window; out-of-window ignored; missing dir → null; malformed first line → null; UUIDv7 decode verified against the two real captured ids); suite; typecheck. **Live end-to-end reserved for the morning** (see below).

5. **Conversations store + id capture wiring (main).** On an agent-tab spawn, upsert a conversation (`id=conversationId, projectId, tool, cwd, title`); claude → `agentSessionId=conversationId` immediately; codex → `agentSessionId` filled when Step-4 discovery resolves. Persist (debounced). IPC: `conversations:list`.
   **Gate:** unit tests (claude captures id at spawn; codex captures on discovery; upsert idempotent); suite; typecheck.

6. **`workspace.json` persistence + window-bounds restore (main + thin renderer).** Renderer serialises pane/tab layout (tabs as `conversationId`) + `sidebarWidth/collapsed` → IPC `workspace:save` (main debounce-writes). `windowBounds` saved on resize/move, restored in `createWindow()`. Per D2: geometry restored, tabs **not** re-materialised.
   **Gate:** store tests (round-trip, migrate, debounce); on-device: window remembers bounds across a restart; suite; typecheck.

7. **Auto-close (§7.2, renderer) — per D3.** A `kind === 'terminal'` (agent) **or** `kind === 'shell'` tab exiting 0 auto-closes; yolo and any non-zero unchanged. Pure predicate + wire into the existing `@exited`/exit path.
   **Gate:** predicate unit test (`terminal`+0 → close; `shell`+0 → close; `yolo`+0 → keep; `terminal`+non-zero → keep; `shell`+non-zero → keep); on-device (clean `/exit` and shell `exit` close; a crash keeps it); suite.

8. **Archive job (main).** `archiveAfterDays` in `ConfigSchema` (default 14, `0` disables). Pure `computeArchivals({projects, now, days, liveProjectIds})` → ids to archive; run at startup + a daily timer; never archive a project with a live tab; reversible (sets `archivedAt`, deletes nothing).
   **Gate:** pure-function tests (14-day threshold, `0` disables, live-tab exemption, idempotent); suite; typecheck.

9. **Final gate + report + design-doc correction.** Full-suite delta vs 520; typecheck; if any UI (auto-close) — DESIGN/PRODUCT pass (no color-only state, no em-dashes in any copy); land the §7.1/§10.3 design-doc correction (D1). **No commit / merge / push without your explicit say-so.**

---

## Reserved for the morning (human at a real terminal — §10.2)

Not automatable (§10.2: codex won't boot a live composer under a scripted pty). I'll build + unit-test the scanner against fixtures; **you** verify the live loop:

1. Launch a real codex agent tab, send a prompt → confirm Step-4 discovery captures the correct session id and `conversations.json` records it.
2. Confirm the spawn-vs-first-message timing: does the rollout file appear at spawn or at first prompt? (`has_user_event=0` on tonight's rows hints the file may exist before a user event — the poll window may be wider than §7.1 assumed. Harmless either way; the scanner keys on cwd+time+`cwd`-confirm, not on `has_user_event`.)
3. Resume that codex conversation via `resumeArgs` and confirm it reattaches.
4. Claude: confirm a fresh `--session-id` launch is resumable, and a clean `/exit` auto-closes its tab.

---

## Git discipline

Branch `feature/s3-persistence` off `develop` after approval. Commits on the feature branch only; no direct commit to `develop`, no push, no merge without explicit say-so. No AI-attribution trailer.
