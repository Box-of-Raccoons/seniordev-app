# S5: Worktree toggle — implementation plan

Status: draft, awaiting approval
Date: 2026-07-30
Branch to create (off `develop`): `feature/s5-worktree-toggle`
Baseline: `develop`, clean tree, **658 tests passing** (S1+S2+S3+S4 merged, pushed, HEAD `2ad55e9`). Confirmed by a real `pnpm test` run as Step 0 before the first edit.
Design source: `docs/superpowers/specs/2026-07-28-seniordev-workspace-epic-design.md` §9 (S5), §4 (data model), §4.3 (git identity resolved live, never stored).
Visual source of truth: `DESIGN.md`, `PRODUCT.md` — S5 adds composer controls + a confirm dialog, so both bind hard (read in full).

Stakes read: **medium-blast, mostly reversible.** Introduces the first git shelling in the app (behind an injectable seam), a new pre-flight IPC that creates a real worktree on disk, and one destructive path (worktree removal on teardown). The destructive path is the only genuinely irreversible action; it is gated behind an explicit confirm and refuses to touch an uncommitted diff. No change to the load-bearing pty/readiness/persistence-write paths — the worktree path rides the *existing, proven* `cwdOverride` channel.

Hardy's forks (decided 2026-07-30):
1. **Worktree creation = pre-flight IPC, refuse in the composer.** `worktree:create` runs BEFORE the composer morphs; on collision the composer shows the reason inline and does not launch.
2. **Full teardown in S5.** A per-conversation teardown affordance in the sidebar → confirm dialog that offers worktree removal, refuses/reports on an uncommitted diff, never silent.
3. **Checkbox in agent Task mode only.** Not Open mode, not the raw Terminal variant.

---

## Evidence grounded in the code (read, not inferred)

| Claim | Where |
| --- | --- |
| A `cwdOverride` already flows composer → LiveTab → spawn request → `resolveCwd` (returns it first when non-empty) → `manager.spawn(...cwd)` → node-pty | `RightPanel.vue:284-287`, `TerminalView.vue:96-108`, `terminal-handlers.ts:128-141`, `resolve.ts:6`, `manager.ts:35` |
| `RepoSchema.branchPrefix` exists, default `''`, **no consumer** | `schema.ts:47`; grep of the launch path |
| There is **no git-shell helper** anywhere; only `execFileSync` in `fix-path.ts` and `child_process` in `headless/node-spawner.ts` | grep `execFile\|child_process\|worktree\|git -C\|rev-parse` over `src/` |
| The injectable-native pattern to mirror: `PtySpawner` type + `nodePtySpawner` ("the ONLY module that imports native node-pty, never import from a test"), injected in `index.ts`, faked in tests | `manager.ts:20`, `node-pty-spawner.ts:6`, `index.ts` (`registerTerminalIpc(getSender, nodePtySpawner, …)`) |
| `Conversation.worktreePath` / `.branch` exist, both `null` today, marked `// S5`; migrate-on-read already tolerates them | `conversations-store.ts:19,45-46,120` |
| `ConversationUpsert` does **not** carry worktreePath/branch; `upsert` never writes them | `conversations-store.ts:55-62,98-128` |
| `Project.worktreeDefault` exists, always written `false`; no setter | `projects-store.ts:11,49,119,153`; no `setWorktreeDefault` |
| A spawn calls `persistence.onAgentSpawn({conversationId, tool, cwd, title, ptyId, preAssignedSessionId})` → `ensureForCwd` + `conversations.upsert` + `emitChange()` | `terminal-handlers.ts:148-158`, `session-persistence.ts:108-138` |
| `configDir(platform, env, home)` / `defaultConfigDir()` resolve the base dir per-platform (`~/.config/SeniorDev`, `%APPDATA%\SeniorDev`) | `paths.ts:5-19` |
| The composer emits `ComposerLaunch`; `launch()` is **synchronous** today; there is **no error surface** in the composer | `Composer.vue:165-182`, `composer-types.ts` |
| `folderTouched` is the exact "stop auto-prefilling once the user takes over" pattern to mirror for the branch field | `Composer.vue:25-27,151-153` |
| Spawn failure already surfaces as `[failed to start: …]` inside the terminal (so a *post-morph* failure has a home, but pre-flight refusal is cleaner per fork 1) | `TerminalView.vue:111-114` |
| The sidebar has **no** conversation delete/archive UI; conv rows carry only focus/resume/drag; only *projects* can be restored | `Sidebar.vue:106-135,217-241` |
| `conversationsForProject` **already** filters `archivedAt === null`, with a comment anticipating S5 conversation archiving | `sidebar-logic.ts:28-32` |
| `conversations-store` has `setArchived` (reversible) but **no** hard `remove`; §4.6 says all conversation data is kept | `conversations-store.ts:74,138-145`; spec §4.6 |
| Reusable modal: `ModalShell.vue` (title + default slot + footer) and `ConfirmDialog.vue` (confirm/cancel, rust destructive button) — the teardown needs an embedded checkbox, so build a small dialog on `ModalShell`, not `ConfirmDialog` | `ConfirmDialog.vue`, `ModalShell.vue` |
| Sidebar read/refresh plumbing to extend: `PROJECTS`/`CONVERSATIONS` IPC, `SIDEBAR.changed` nudge, `registerSidebarIpc({persistence, workspace, getSender})`, preload `onSidebarChanged` | `ipc.ts:137-139`, `preload/index.ts:27-35`, `index.ts` (`registerSidebarIpc(...)`) |

---

## Architecture decisions (stated)

### The git seam (mirrors PtySpawner)
- **`src/main/git/git-runner.ts`** — `export interface GitResult { code: number; stdout: string; stderr: string }`; `export type GitRunner = (cwd: string, args: string[]) => GitResult`. Plus **pure, DOM/IO-free helpers** (unit-tested directly): `slugifyForBranch(prompt): string`, `sanitizeBranchRef(s): string` (valid-git-ref: lowercase, invalid chars → `-`, collapse repeats, allow internal `/`, strip leading/trailing `-`/`/`/`.`, no `..`/`@{`/trailing `.lock`, **fallback `'task'` when empty** so an empty `branchPrefix` still yields a valid name — "easy to get wrong" #2), `worktreePathSegment(branch)` (branch with `/`→`-` so the path never nests deeply), `worktreePathFor(configDir, repoKey, branch)` (`join(configDir,'worktrees',repoKey,segment)` — via `node:path`, cross-platform, "easy to get wrong" #5).
- **`src/main/git/node-git-runner.ts`** — the ONLY module importing `child_process` for git: `execFileSync('git', args, { cwd, encoding:'utf8', timeout })`, returns `GitResult` (never throws; non-zero code + stderr captured). Carries the same "never import this from a test" banner as `node-pty-spawner.ts`.
- **`src/main/git/worktree-service.ts`** — orchestration over an injected `GitRunner` (so tests never shell real git):
  - `gitRepoInfo(runner, folder) → { isRepo: boolean }` via `rev-parse --is-inside-work-tree` (live; caching is the handler's job).
  - `createWorktree(runner, { configDir, folder, repoKey, branch }) → { ok:true, worktreePath, branch } | { ok:false, error }`: sanitize branch, compute path, run `git -C <folder> worktree add -b <branch> <worktreePath> HEAD`. Base off HEAD (spec §9; remote-branch base deferred). **Collision** ("easy to get wrong" #3): branch or path already exists → git exits non-zero → map stderr to a clear message (`branch '<b>' already exists` / `worktree path already exists`) and return `ok:false`. **Never reuse silently.**
  - `removeWorktree(runner, { folder, worktreePath }) → { ok:true } | { ok:false, error }`: `git -C <folder> worktree remove <worktreePath>` **without `--force`**, so git itself refuses when the tree is dirty/untracked; surface stderr verbatim. This is how "never remove one with uncommitted changes silently" is enforced — by declining to force, not by our own diff parse (defense-in-depth: we also never pass `--force`).

### IPC surface (new `registerWorktreeIpc`, wired with `nodeGitRunner`)
- `WORKTREE = { info, create, teardown }` in `shared/ipc.ts` + wire types.
- **`worktree:info`** invoke `{ folder }` → `{ isRepo, branchPrefix, worktreeDefault }`. `isRepo` via the runner (live), **cached ~60s per folder** (spec §4.3, adopted from the RepositoryIdentityResolver idea — nothing stored on disk, just an in-memory TTL map). `branchPrefix` resolved by normalized-path match against `config.repos` (empty when the folder is a git repo but not a configured repo). `worktreeDefault` read from the projects store by normalized-path match (so the checkbox remembers the last per-project choice).
- **`worktree:create`** invoke `{ folder, branch }` → `worktree-service.createWorktree(...)` result. `repoKey` = a configured repo's `key` if matched, else the folder basename. **This is the pre-flight step (fork 1):** the composer awaits it and only morphs on `ok:true`.
- **`worktree:teardown`** invoke `{ conversationId, removeWorktree: boolean }` → archives the conversation (`conversations.setArchived(id, true)` — reversible, §4.6-compliant; the `archivedAt` filter already drops it from the list) and, only when `removeWorktree` is true and the conversation has a `worktreePath`, calls `removeWorktree(...)`. Returns `{ archived:true, worktree?: { ok, error? } }`. Emits `SIDEBAR.changed`. **The archive always succeeds; a worktree-removal failure is reported, never blocks the archive, never forces** (stale worktree preferable to a destroyed diff — spec §9).
- Preload: `worktreeInfo`, `createWorktree`, `teardownConversation`.

### Recording on the conversation + project (thread through the spawn, single write)
- `SpawnTerminalRequest` gains `worktreePath?`, `branch?`, `worktreeDefault?` (all optional; every existing/test caller omits them). `TerminalView` passes them into `spawnTerminal`. `terminal-handlers` passes them into `onAgentSpawn`.
- `AgentSpawnInfo` gains `worktreePath?`, `branch?`, `worktreeDefault?`. `onAgentSpawn`: `ConversationUpsert` gains `worktreePath?`/`branch?` and `upsert` writes them (insert and update); and when `worktreeDefault !== undefined`, call a new `projects.setWorktreeDefault(project.id, worktreeDefault)`. Because only Task-mode agent launches carry `worktreeDefault`, Open/terminal launches never clobber the remembered choice.

### Composer (Task mode only — fork 3)
- New controls rendered **inside the `isTask` block, directly under the Folder field** ("beside the folder picker", scoped to Task mode):
  - Checkbox **"run in a new worktree"**, default off. **Disabled with a visible reason** ("not a git repository") when `worktree:info` reports `isRepo:false` — never color-only (DESIGN §2); a text reason beside the disabled control.
  - Editable **branch** text field, shown only when the checkbox is on. Prefilled `branchPrefix + slugifyForBranch(input)`; re-derived as the input changes **until the user edits the branch** (`branchTouched`, mirroring `folderTouched` at `Composer.vue:25-27`). Sanitized to a valid ref on input; empty → `'task'` fallback shown, so the field is never invalid.
  - A `worktreeInfo` fetch on folder change (debounced), prefilling the checkbox from `worktreeDefault`.
  - An **error line** (rust, DESIGN state-color, paired with text) for a `worktree:create` refusal.
- `launch()` becomes **async**: when Task + checkbox on + isRepo, `await window.api.createWorktree({ folder, branch })`; on `ok:false` set the error and **return without emitting** (fork 1); on `ok:true` emit `ComposerLaunch` with `worktreePath`, `branch`, `worktreeChoice:true`. When the checkbox is off in Task mode, emit `worktreeChoice:false` (so the default is remembered). `ComposerLaunch` gains `worktreePath?`, `branch?`, `worktreeChoice?`.

### RightPanel launch wiring
- `launch(t, p)`: when `p.worktreePath` is set, `t.cwdOverride = p.worktreePath` (else `p.folder` as today) and store `t.worktreePath`/`t.branch`; carry `p.worktreeChoice` → the spawn request's `worktreeDefault`. `LiveTab` gains `worktreePath?`/`branch?`/`worktreeDefault?`. `TerminalView` threads them into `spawnTerminal`. **This is the "cwd flows all the way to node-pty" guarantee (item 1):** the worktree path becomes the same `cwdOverride` that already reaches `manager.spawn`, verified by a handler test asserting `manager.spawn` received `cwd === worktreePath`.

### Sidebar teardown UI (full — fork 2)
- Each conversation row gets a teardown control (an `×`/archive button, visible on hover/focus, keyboard-reachable, `aria-label`). Clicking opens a small **`WorktreeTeardownDialog.vue`** built on `ModalShell` (DESIGN §5 sanctioned confirm-gate; rust destructive button as in `ConfirmDialog`):
  - Copy: "Archive this conversation?" (honest: it archives, data kept per §4.6).
  - When the conversation has a `worktreePath`: a checkbox "also remove its worktree (`<path>`)", **default off** (safe). Reduced-motion honored; visible focus; no em-dashes.
  - On confirm → `window.api.teardownConversation({ conversationId, removeWorktree })`. If the result's `worktree.ok === false`, keep the dialog open (or show inline) reporting `worktree.error` ("Worktree not removed: …") — never silent. The archive has already applied; `SIDEBAR.changed` refreshes the row out of the list.
- Pure decision logic in `sidebar-logic.ts` (DOM-free, unit-tested): `teardownOffersWorktree(conv) → boolean` (only when `worktreePath` set).

---

## Steps (each with its own gate; gates report a delta vs 658)

0. **Baseline.** `pnpm test` + typecheck on a clean `develop`. **Gate:** confirm 658 green, record any failing names, before any edit.

1. **Git seam + pure helpers + worktree service.** `git/git-runner.ts` (types + pure helpers), `git/node-git-runner.ts` (native, never-from-a-test banner), `git/worktree-service.ts` (create/remove/repoInfo over an injected runner).
   **Gate:** `git-runner.test.ts` (slugify; sanitizeBranchRef incl. empty→`task`, empty-prefix, `/`-preservation, invalid-char, `..`/`.lock` edges; worktreePathFor cross-platform via `node:path`), `worktree-service.test.ts` with a **fake runner** (create success; branch-exists collision; path-exists collision; not-a-repo; remove success; remove refused-when-dirty surfaces stderr; never passes `--force`). Typecheck; suite `658 + N`.

2. **IPC surface + persistence threading.** `shared/ipc.ts` (`WORKTREE={info,create,teardown}` + wire types); `registerWorktreeIpc({ gitRunner, source, persistence, configDir, getSender })` (info with 60s cache; create; teardown) wired in `index.ts` with a new `nodeGitRunner`; preload methods. Extend `SpawnTerminalRequest` + `AgentSpawnInfo` + `ConversationUpsert` (worktreePath/branch) and add `projects.setWorktreeDefault`; `onAgentSpawn` writes them and sets worktreeDefault when defined.
   **Gate:** handler/wiring tests with a fake runner + in-memory stores (info caches within 60s and resolves branchPrefix/worktreeDefault by path; create returns path & maps collisions; teardown archives always, removes only when opted-in, reports failure without blocking archive, emits changed; `onAgentSpawn` persists worktreePath/branch + worktreeDefault). Typecheck; suite delta.

3. **Composer (Task mode) controls.** Checkbox (disabled + visible reason when not a repo) + editable branch field (prefill branchPrefix+slug, `branchTouched`, sanitize, `task` fallback), debounced `worktree:info` fetch + worktreeDefault prefill, error line, async `launch()` that pre-flights `worktree:create` and **refuses without emitting** on failure. `ComposerLaunch` gains worktreePath/branch/worktreeChoice.
   **Gate:** `Composer.test.ts` additive (checkbox disabled + reason when `isRepo:false`; branch prefill = prefix+slug and stops re-deriving after a manual edit; empty prefix+empty input → `task`; launch refuses + shows error on `create` failure and does NOT emit; launch on success emits worktreePath+branch+worktreeChoice; checkbox absent in Open/terminal). Typecheck; **on-device**; suite delta.

4. **RightPanel launch → spawn wiring (cwd flow).** `launch()` sets `t.cwdOverride = worktreePath` when present and stores worktreePath/branch/worktreeChoice; `LiveTab` + `TerminalView` thread worktreePath/branch/worktreeDefault into `spawnTerminal`.
   **Gate:** `RightPanel.test.ts` additive (a worktree launch sets cwdOverride = worktreePath and the spawn request carries worktreePath/branch/worktreeDefault); a **terminal-handlers test asserting `manager.spawn` cwd === worktreePath** (item 1: cwd reaches node-pty, not just the record). Typecheck; suite delta.

5. **Sidebar teardown UI.** `WorktreeTeardownDialog.vue` on `ModalShell` (archive + optional worktree-removal checkbox, failure report, reduced-motion, focus, no em-dashes); a teardown control on each conv row; `teardownOffersWorktree` pure helper; preload `teardownConversation`.
   **Gate:** `sidebar-logic.test.ts` (`teardownOffersWorktree` true only with a worktreePath), dialog component test (checkbox shown only when a worktree exists; confirm emits the right payload; a failure result renders the reason), `Sidebar.test.ts` additive. Typecheck; **on-device** (archive a conv; decline vs accept worktree removal; dirty-refusal reported). Suite delta.

6. **Final gate + report + DESIGN/PRODUCT pass.** Full-suite delta vs 658; typecheck; DESIGN checklist walk (color-is-state on the disabled reason + error line + destructive button; reduced-motion; AA on any new text incl. `ink-muted`; visible focus on checkbox/branch field/teardown control/dialog; One Signal / no stray teal; no em-dashes). **No commit / merge / push without your explicit say-so.**

---

## Decisions I'm making (low-blast — stated, not asking)

- **Teardown = archive, not hard delete.** §4.6 keeps all conversation data; `conversationsForProject` already filters `archivedAt === null` (sidebar-logic.ts:32) so archiving removes the row without a schema change or a new store method. The dialog copy says "Archive" to stay honest.
- **`repoKey` for the worktree path** = a configured repo's `key` when the folder matches one, else the folder basename. Keeps `<configDir>/worktrees/<repo>/<branch>` readable and stable.
- **`worktree:info` cache is in-memory, ~60s, per folder** (spec §4.3: git identity is resolved live and never stored). Cleared on config change is not required for correctness; a 60s TTL is enough.
- **Worktree base = HEAD only.** Remote-tracking base (`startFromOrigin`) is deferred per spec §9.
- **Worktree-removal never forces.** We decline `--force`; git's own refusal on a dirty tree is the safety mechanism, reported verbatim.

## Assumptions to verify during Step 0 / implementation (flagged, not load-bearing yet)

- `git` is on PATH at runtime. GUI-launched macOS apps get PATH repaired by `applyFixedPath()` (fix-path.ts) before any spawn; the same repaired PATH covers `execFileSync('git', …)`. **Inferred**; confirm the git runner runs after `applyFixedPath()` in `index.ts` ordering.
- Reusing `ModalShell` for the teardown dialog matches the other modals' mount/teardown lifecycle — confirm by reading one existing consumer (e.g. `AppConfigModal.vue`) before writing the dialog.

---

## On-device (yours to verify — the test env can't)

1. Task-mode composer on a **git folder**: the checkbox is enabled; on a **non-git folder** it is disabled with the reason shown.
2. The branch field prefills `branchPrefix + slug`, is editable, and a manual edit sticks; launching creates `<configDir>/worktrees/<repo>/<branch>` and the agent's terminal cwd IS that worktree (`pwd` / the shell prompt).
3. A **collision** (relaunch the same branch) refuses in the composer with a clear reason and does not morph.
4. Re-opening the composer for that project **remembers** the last checkbox choice (worktreeDefault).
5. Archiving a conversation with a worktree offers removal; declining keeps the worktree; accepting removes a **clean** worktree; accepting on a **dirty** worktree reports the refusal and leaves it intact.
6. `branchPrefix` empty (default) still produces a valid branch and a working worktree.

---

## Git discipline

Branch `feature/s5-worktree-toggle` off `develop` after approval. Commits on the feature branch only; no direct commit to `develop`, no push, no merge without explicit say-so. No AI-attribution trailer.
