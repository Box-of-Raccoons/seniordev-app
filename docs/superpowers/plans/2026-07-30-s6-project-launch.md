# S6: Project-centric launch + conversation restore — implementation plan

Status: draft, awaiting approval
Date: 2026-07-30
Branch to create (off `develop`): `feature/s6-project-launch`
Baseline: `develop` at `b378a9c` (S1–S5 merged), **715 tests**, typecheck clean, build compiles. Confirmed by a real `pnpm test` as Step 0.
Design source of truth: `DESIGN.md`, `PRODUCT.md` (heavy sidebar/composer UI — both bind).
Note: `develop` is currently **unpushed** (2 commits ahead of origin). Branching off local `develop` is fine; the push is a separate decision.

Stakes read: **medium-blast, reversible.** A UX paradigm shift (projects become the launch entry point) plus a small restore affordance. It relocates existing controls and adds a folder-locked composer mode; it does not touch the pty/spawn/persistence write paths, the worktree seam, or the sync contract. The one behavioral change users feel: the per-pane `+` goes away and launches originate from the sidebar.

Hardy's calls (2026-07-30):
1. **AI = composer (folder locked to the project); Open + Terminal launch instantly** into the project (default tool / default shell), no composer.
2. **Remove the per-pane `+`**; projects are the sole launch entry. New sessions open into the **leftmost** pane (consistent with resume; "never surprise-open where you're not looking").
3. **Folder is hidden/locked** when launched from a project — shown as a read-only "Project: <name>" header, never re-picked.
4. **New Project**: pick a folder → the project row appears at top → its launch menu opens immediately.

Plus the deferred gap from S5: **restore an archived conversation**.

---

## Evidence grounded in the code (read, not inferred)

| Claim | Where |
| --- | --- |
| The `+` menu (`NewTabMenu`) lives in each pane's tab strip; emits `pick {variant, mode}`; `RightPanel.onPick` turns it into a composer tab | `RightPanel.vue` term-bar (`<NewTabMenu @pick>`), `onPick` (~263) |
| `NewTabMenu`'s trigger is **teal** (`.new-session { background: var(--teal) }`) | `NewTabMenu.vue:82-85` |
| The sidebar already launches by calling `ws.panes.addTab(...)` directly (resume path), and focuses via `ws.panes.focusTab` — no RightPanel ref needed | `Sidebar.vue:106-119` (`clickConversation`) |
| `addTab(partial, toPaneId?)` accepts a target pane; `leftmostPaneId` exists | `usePanes.ts:133-143,112` |
| The composer accepts `initialFolder` and treats a prefilled folder as chosen (`folderTouched`), and renders the folder field + recent/repo chips unconditionally | `Composer.vue:24-27,206-243` |
| `openComposer({folder})` (deep-link path) and the native "new-session" → `newTab()` both still create folder-editable composers | `App.vue:46-63`, `RightPanel.vue` `newTab`/`openComposer` |
| A folder picker exists (`window.api.pickFolder` → `dialog:pickFolder`); `listShells()` returns `{shells, default}` | `preload/index.ts:12,21` |
| Projects auto-create on spawn via `projects.ensureForCwd(cwd,{defaultTool})`; there is **no** `projects:create`/`ensure` IPC and **no** `conversations:setArchived` IPC | `session-persistence.ts:109`, `ipc.ts:137-138` (only `projects.{list,setArchived}`, `conversations.list`) |
| `conversations-store.setArchived(id, archived)` exists (reversible) and `conversationsForProject` filters `archivedAt === null` | `conversations-store.ts:138-145`, `sidebar-logic.ts:30-32` |
| A shell tab (`spawnShell`) is **not** recorded as a conversation (no conversationId → no `onAgentSpawn`) | `terminal-handlers.ts` `TERM.spawnShell` (no persistence call) |
| Projects have a Restore control; conversations do not | `Sidebar.vue` archived section (projects only) |

---

## Decisions I'm making (low-blast — stated, not asking)

- **Sessions open into the leftmost pane** (like resume). Easy to change to focused-pane later; flagged.
- **The per-project `+` is a ghost/muted control**, not teal (One Signal Rule — teal stays for the composer's Launch and is not spent on a repeated sidebar control). Shown always, right of the project name; keyboard-reachable. **New Project** is a single restrained button at the top (tan/ghost, not a second teal).
- **Native menu "New Session" and deep links keep the folder-editable composer** (`newTab`/`openComposer`) as the non-project fallback — unchanged, so nothing that relied on them breaks.
- **Instant Terminal is a raw shell tab, not a recorded conversation** (matches today); a pure shell won't bump the project's `lastActiveAt` or appear as a sidebar conversation. Instant Open (bare agent) DOES record a conversation (it spawns with a conversationId → `onAgentSpawn`). Noted, not changed.
- **Restore UI = a per-project "Archived (n)" conversations reveal** with a Restore per row (mirrors the project archived section), driven by a new `conversations:setArchived` IPC.
- **`NewTabMenu` gets a `ghost?: boolean` prop** for the trigger appearance so it can be reused per-project without duplicating the menu/keyboard logic; the pane copy is removed, so only the ghost form ships.

---

## Steps (each with its own gate; gates report a delta vs 715)

0. **Baseline.** `pnpm test` + typecheck on clean `develop`. **Gate:** 715 green recorded before any edit.

1. **IPC: project ensure + conversation restore.** `shared/ipc.ts`: `PROJECTS.ensure` (invoke `{folder}` → `ProjectInfo`) and `CONVERSATIONS.setArchived` (invoke `{id, archived}`). Handlers in `sidebar-handlers.ts` (or a small addition): `ensure` → `persistence.projects.ensureForCwd(folder, {defaultTool})` + emit `SIDEBAR.changed` + return the row; `setArchived` → `persistence.conversations.setArchived(id, archived)` + emit. Preload: `ensureProject(folder)`, `setConversationArchived(id, archived)`.
   **Gate:** handler tests (ensure creates/refreshes + emits + returns; setArchived toggles + emits); typecheck; suite `715 + N`.

2. **Pure sidebar logic.** `sidebar-logic.ts`: `archivedConversationsForProject(convs, projectId)` (archivedAt != null, recency sorted). Launch-spec builders (DOM-free, unit-tested): `openSessionTabSpec(project)` (bare agent: kind terminal, tool = project.defaultTool, cwdOverride = project.path, title), `terminalTabSpec(project, shell)` (kind shell), and `composerTabSpec(project)` (kind composer, variant agent, project-locked prefill). Keeps the Sidebar view thin.
   **Gate:** `sidebar-logic.test.ts` cases for the new builders + archived filter; typecheck; delta.

3. **Composer project-locked mode.** Props `projectName?: string` + `lockFolder?: boolean`. When locked: hide the Folder field + recent/repo chips, render a read-only "Project: <name>" header, and keep `folder` pinned to `initialFolder` (worktree toggle still reads it). Non-locked path unchanged.
   **Gate:** `Composer.test.ts` (locked: no folder input, header shown, launch still emits the folder; unlocked: folder field present as before); typecheck; delta.

4. **Sidebar: launch controls + restore.** Per-project ghost `+` (reuse `NewTabMenu` with `ghost`): `pick agent` → `ws.panes.addTab(composerTabSpec(project), leftmost)`; `pick agent/open` → `addTab(openSessionTabSpec(project), leftmost)`; `pick terminal` → resolve `listShells().default`, `addTab(terminalTabSpec(project, shell), leftmost)`. A **New Project** button at top → `pickFolder()` → `ensureProject()` → refresh → auto-open that project's menu. A per-project **Archived (n)** conversations reveal with Restore (`setConversationArchived(id,false)` + refresh). All DESIGN rules (ghost not teal, tonal steps, focus, reduced-motion, no em-dashes).
   **Gate:** `Sidebar.test.ts` (each pick adds the right tab spec to the leftmost pane; New Project ensures + opens the menu; Restore calls the IPC and the row returns); typecheck; **on-device**; delta.

5. **RightPanel: remove the per-pane `+`.** Drop `<NewTabMenu>` from the term-bar and the now-unused `onPick`. Keep `newTab`/`openComposer` (native menu + deep-link fallback), the empty state, and all drag/drop. Update `RightPanel.test.ts` (remove `.pick-*`-driven cases or repoint them through `ws.panes`/exposed methods).
   **Gate:** `RightPanel.test.ts` green (repointed, not deleted — report before/after count and that no assertion was silently dropped); typecheck; delta.

6. **Final gate + report + DESIGN/PRODUCT pass.** Full-suite delta vs 715; typecheck; build; DESIGN walk (One Signal: exactly one teal per surface; ghost + controls; tonal steps; focus on every new control; reduced-motion; AA; no em-dashes). **No commit / merge / push without your say-so.**

---

## Open question (flagged, your call — not deciding alone)

With the pane `+` gone, **every** new session opens into the leftmost pane, then you drag to arrange. If you'd rather a project launch target the **focused** pane (open where you're working), that's a one-line change in Step 4 — but it reintroduces the "opened where I wasn't looking" risk the leftmost rule avoids. I've planned leftmost; say the word if you want focused.

## On-device (yours to verify — the test env can't)

1. A project's `+` → AI opens a folder-locked composer (project name as header, no folder field); Launch runs in the project.
2. `+` → Open runs a bare agent in the project immediately (one click); `+` → Terminal opens a shell in the project immediately.
3. New Project → folder picker → the row appears at top and its menu opens; picking launches.
4. The per-pane `+` is gone; the tab strip is just tabs; drag-to-split still works.
5. Archive a conversation, reveal Archived (n) under its project, Restore it → it returns to the list.
6. One teal action per surface (composer Launch); the sidebar `+`s read as secondary.

## Git discipline

Branch `feature/s6-project-launch` off `develop` after approval. Commits on the feature branch only; no direct commit to `develop`, no push, no merge without explicit say-so. No AI-attribution trailer; no em-dashes in shipped copy.
