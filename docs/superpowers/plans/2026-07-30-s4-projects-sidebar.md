# S4: Projects sidebar — implementation plan

Status: draft, awaiting approval
Date: 2026-07-30
Branch to create (off `develop`): `feature/s4-projects-sidebar`
Baseline: `develop`, clean tree, **594 tests passing** (S1+S2+S3 merged, pushed). Confirmed by a real `pnpm test` run as Step 0 before the first edit.
Design source: `docs/superpowers/specs/2026-07-28-seniordev-workspace-epic-design.md` §8 (S4), §4 (data model), §3 (ordering).
Consumes: S3 stores (`projects-store`, `conversations-store`, `workspace-store`) + S3's `SessionPersistence`. S2's `usePanes` + native-HTML5 DnD.
Visual source of truth: `DESIGN.md`, `PRODUCT.md` — S4 is heavily UI, so both bind hard (read in full).

Stakes read: **medium-blast, reversible.** Adds a new read-only IPC surface + a refresh signal, extends `usePanes` additively, and adds one left panel to the shell. No contract migration, no change to the load-bearing pty/readiness/persistence-write paths. The one structural change is the shell layout (a left column beside the pane area).

---

## Evidence grounded in the code (read, not inferred)

| Claim | Where |
| --- | --- |
| `projects:list` / `conversations:list` IPC do **not** exist yet | grep of `shared/ipc.ts`, `preload/index.ts` — only `WORKSPACE.{getSettings,save}` present |
| `persistence` (`SessionPersistence`) is instantiated in `index.ts` and exposes `.projects` / `.conversations` (read APIs: `list/get/byProject/active/archived`, `setArchived`) | `index.ts:244`, `session-persistence.ts:25-36`, `projects-store.ts:59-73`, `conversations-store.ts:64-76` |
| App shell is RightPanel-only | `App.vue:93-95` (`<div class="shell"><RightPanel/></div>`); no `Sidebar`/`LeftPanel` file exists |
| RightPanel owns `usePanes` + the single `workspace:save` watcher; `serializeLayout()` already emits `sidebarWidth:null, sidebarCollapsed:false` | `RightPanel.vue:25,183-206` |
| `workspace-store` already persists `sidebarWidth`/`sidebarCollapsed` via `setLayout`, but there is **no read IPC** for them | `workspace-store.ts:19-25,74-80`; `ipc.ts` WORKSPACE has no getSidebar |
| `LiveTab.resume = {sessionId}` drives `buildInteractiveLaunch` resumeArgs; on resume, `--session-id` is **not** re-passed | `usePanes.ts:21`, `session.ts:46-57` |
| A spawn calls `persistence.onAgentSpawn({conversationId,...})` which upserts a conversation **keyed by conversationId** | `terminal-handlers.ts:149-156`, `session-persistence.ts:58-81` |
| `addTab` always **mints a fresh** conversationId (`NewTab` omits it) | `usePanes.ts:36,119-126` |
| Pane drop handlers read `text/plain` as a **ptyId** | `RightPanel.vue:113-146` |
| RightPanel.test.ts mounts `RightPanel` and drives its internal panes across ~20 cases | `RightPanel.test.ts` (281 lines, `mountRP()`) |
| `agentSessionId === null` ⇒ not resumable (codex where nothing ran, or discovery missed) | `conversations-store.ts:16-18`, spec §8 |

---

## D1 — Where the sidebar mounts — DECIDED: A3 (lift to App.vue)

**Hardy's call (2026-07-30): A3.** Lift the workspace layout state out of RightPanel into a `useWorkspace` composable instantiated in `App.vue`; `Sidebar.vue` becomes a **sibling** of RightPanel, both reading the shared `ws`. This is the "shell owns the workspace" shape and the cleaner long-term architecture. Accepted cost: RightPanel stops instantiating its own model, and the model/save/status tests currently in `RightPanel.test.ts` migrate to a new `useWorkspace.test.ts` (mount-free), leaving RightPanel.test.ts the view/interaction cases (mounted with an injected `ws`).

**What lifts into `useWorkspace` (the shared, layout-level concerns):**
- `panes = usePanes()` — the tab/pane model (both children need it).
- `statuses` (reactive `Record<ptyId, TabStatus>`) + the `STATUS.update` listener + `maybeNotify` — the Sidebar draws a conversation's glyph from `statuses[ptyId]`, so the map must be shared, not RightPanel-local.
- `sidebarWidth` / `sidebarCollapsed` refs (restored on mount via `workspace:getSidebar`).
- the single debounced `workspace:save` watcher (panes + sidebar geometry → `serializeLayout`).
- the high-level actions `App` drives (`newTab`, `openComposer`, `startStartupSession`, `closeAll`, `hasSessions`, `moveActiveTab`) — App calls `ws.*` directly, dropping the `rightPanel.value?.*` ref indirection.

**What stays in `RightPanel.vue` (the pane-area view/interaction), now operating on `props.ws`:**
- the teleport list + composer/terminal/yolo rendering, the New-tab menu, tab strip.
- `launch` (composer→terminal morph), `onTabExited` (auto-close), `resumeYolo`.
- pane drag/drop reordering + splitter resize (S2), extended in Step 6 to accept conversation drops.

`App.vue` shell becomes a flex row: `<Sidebar :ws> | <RightPanel :ws>`, the sidebar column width/collapse driven by `ws.sidebarWidth/Collapsed`.

---

## Decisions I'm making (low-blast — stated, not asking)

- **Resume reuses the original `conversationId`.** Resuming from the sidebar must **not** fork a duplicate sidebar row. `addTab` currently mints a fresh conversationId, and a spawn upserts a record keyed by it — so a resumed tab with a new id would create a second conversation. Fix: extend `NewTab` to allow an optional `conversationId`; the resume path passes `conversation.id`, so `onAgentSpawn`'s upsert is idempotent on the existing record. (claude: resume path won't re-pass `--session-id`, harmless. codex: re-discovery is harmless.) Existing callers unaffected (they pass no id → still mint).
- **Read-only IPC + a refresh signal.** New `projects:list`, `conversations:list` (invoke, return the full stored lists), `projects:setArchived` (restore, invoke), and a one-way `sidebar:changed` event (main → renderer) so the sidebar re-fetches when a spawn creates/updates a project or conversation, when codex discovery fills `agentSessionId`, or when the archive job / a restore mutates a project. Live-tab open/close/focus is renderer-reactive (via `usePanes`), so it needs **no** IPC.
- **Wire types mirror the store shapes in `shared/ipc.ts`** (`ProjectInfo`, `ConversationInfo`). The renderer must not import from `main/store` (that pulls in electron/fs); `shared/ipc` is the boundary, matching every existing channel.
- **Sidebar width/collapsed restore via a new `workspace:getSidebar` read** (returns `{width, collapsed}` from `workspace.json`). `serializeLayout()` starts emitting the live sidebar values instead of `null/false`. Per S3-D2, tabs are still **not** re-materialised on boot — only the sidebar geometry is restored.
- **Drag discrimination by dataTransfer type.** Sidebar rows drag with `application/x-sd-conversation` = conversationId. Pane drop handlers branch: a conversation-drop → if the conversation has a live tab, `moveTab` it into that pane; else if resumable, resume into that pane; else no-op. Tab drags (`text/plain` = ptyId) are unchanged.

### Visual decisions (DESIGN-bound — stated)

- **Planes:** sidebar sits on `bg` (deepest). Open row lifts to `surface-2` (spec §8's tonal step, "bg → surface-2"), hover to `surface`. **No coloured side-border stripe** (DESIGN §6 absolute ban) — tone only.
- **Open vs selected are separate signals.** Open = the `surface-2` tonal step. Keyboard selection/focus = the visible teal `focus-visible` outline (the reserved 1px hairline stays available if selection needs more). The **status glyph** (reused S1 `StatusGlyph`) is a third, independent signal — "is it open" and "what is it doing" never share a mark.
- **No live tab ⇒ no dot + dimmed row** (`ink-muted`). **`agentSessionId === null` ⇒ shown as non-resumable** (further dimmed, not click-to-resume, labelled so it's not a dead click).
- **`prefers-reduced-motion`** honoured on any expand/collapse (instant/crossfade fallback). AA contrast (verify `ink-muted` clears 4.5:1 on `bg`). Visible focus on every row/control. **No em-dashes** in any UI copy.

---

## Steps (each with its own gate; gates report a delta vs 594)

0. **Baseline.** `pnpm test` + typecheck on a clean `develop`; record pass count + any failing names. **Gate:** confirm 594 green before any edit.

1. **Read + refresh IPC (main + preload + shared types).** `shared/ipc.ts`: `PROJECTS = {list,setArchived}`, `CONVERSATIONS = {list}`, `SIDEBAR = {changed}`, `WORKSPACE.getSidebar`, and `ProjectInfo`/`ConversationInfo`/`SidebarState` wire types. Main: register handlers (`projects.list()/active()/archived()`, `conversations.list()`, `projects.setArchived`+emit changed, workspace `getSidebar`); thread an `onChange` into `createSessionPersistence` wired to `getSender()?.send(SIDEBAR.changed)`, fired after `onAgentSpawn`, codex `setAgentSessionId`, `runArchive`, and restore. Preload: `listProjects`, `listConversations`, `setProjectArchived`, `getSidebarState`, `onSidebarChanged`.
   **Gate:** wiring/unit test (onChange fires on spawn/discovery/archive/restore; `list` returns store contents; getSidebar round-trips); typecheck; suite `594 + N`.

2. **`usePanes` extensions (additive).** `NewTab` allows optional `conversationId`; `addTab` uses it or mints. Add `leftmostPaneId` and `findByConversationId(convId) → {ptyId,paneId} | null` (across all panes). `focusTab` already exists.
   **Gate:** extend `usePanes.test.ts` (addTab honours a provided conversationId, mints when absent; findByConversationId matches across panes and returns null when absent; leftmost is panes[0]); typecheck; suite delta.

3. **`useWorkspace` lift (the A3 refactor — pure move, no behaviour change).** Extract into `src/renderer/src/composables/useWorkspace.ts`: the `usePanes()` instance, the `statuses` map + `STATUS.update` listener + `maybeNotify`, `sidebarWidth`/`sidebarCollapsed` refs (restored via `getSidebarState`), the debounced `workspace:save` watcher (panes + sidebar), and the action methods (`newTab`/`openComposer`/`startStartupSession`/`closeAll`/`hasSessions`/`moveActiveTab`). `App.vue` instantiates `ws = useWorkspace()`, wires menu/startup/deeplink to `ws.*`, and passes `ws` to `RightPanel`. `RightPanel.vue` drops its own `usePanes()`/`statuses`/save and reads `props.ws`, keeping the view/launch/exit/drag concerns.
   **Gate:** migrate tests — model/save/status/notify cases move from `RightPanel.test.ts` to a new mount-free `useWorkspace.test.ts`; `RightPanel.test.ts` keeps view/drag/launch/exit cases, mounting with an injected `ws`. Behaviour is unchanged, so the **full suite must be green with net test count accounted for** (relocated, not deleted — report the exact before/after and that no assertion was dropped). Typecheck.

4. **Pure sidebar logic.** `src/renderer/src/composables/sidebar-logic.ts`: `activeProjectsByRecency`, `conversationsForProject` (sorted lastActiveAt desc), `capConversations(list, level)` (5 → "show more" 10 → "show all"), `rowState(conv, liveByConvId)` → `{open, ptyId?, paneId?, resumable}`, `resumeTargetPaneId(panes)` (leftmost). All DOM-free.
   **Gate:** `sidebar-logic.test.ts` full coverage (recency sort; 5/10/all cap transitions incl. <5 and exactly-5 edges; rowState open/resumable/dimmed matrix; resume target = leftmost); typecheck; suite delta.

5. **`Sidebar.vue` as an App sibling (visual — the bulk step).** New `Sidebar.vue` reading `props.ws`: projects (recency), each expanding to capped conversations, `Archived (n)` collapsed at bottom with per-project Restore, a collapse toggle + a reveal rail when collapsed. Fetches projects/conversations via IPC, refetches on `sidebar:changed`; derives per-row open/status/resumable from `ws.panes` + `ws.statuses` via the Step 4 logic. Actions: focus a live conversation (`ws.panes.focusTab`), resume a dead-but-resumable one into the leftmost pane (`ws.panes.addTab({conversationId: conv.id, resume, cwdOverride, tool}, leftmostPaneId)`), restore a project. `App.vue` renders it as the left flex column with width/collapse from `ws`, and a persisted min/max-clamped width resize handle. All DESIGN rules honoured.
   **Gate:** typecheck; `RightPanel.test.ts`/`App.test.ts` green (additive); **on-device visual verification** against DESIGN (tonal step not stripe; glyph separate from open-state; dimmed non-resumable rows; focus visible; reduced-motion; AA; no em-dashes); suite delta.

6. **Drag a sidebar row → a specific pane.** Rows draggable with `application/x-sd-conversation`; RightPanel drop handlers branch on the type (live → `moveTab` into the pane; dead+resumable → resume into the pane; non-resumable → no-op). Edge drop zones show during a conversation drag too.
   **Gate:** pure drop-decision helper unit test (live→move; dead+resumable→resume; non-resumable→noop; unknown id→noop); typecheck; on-device (drag a row into a second pane); suite delta.

7. **Final gate + report + DESIGN/PRODUCT pass.** Full-suite delta vs 594; typecheck; DESIGN checklist walk (color-is-state, tonal step, reduced-motion, AA, focus, One Signal / no stray teal, no em-dashes). **No commit / merge / push without your explicit say-so.**

---

## On-device (yours to verify — the test env can't)

The sidebar itself is visual; the pure logic is unit-tested but the rendered result is on-device:
1. A launched agent tab appears as an open row with its live status glyph; clicking it from another pane focuses it there.
2. A conversation with no live tab shows dimmed, no dot; clicking a resumable one spawns a resumed pty into the **leftmost** pane and re-attaches (claude `--resume`; codex `resume`), with **no duplicate** sidebar row.
3. A `null`-agentSessionId conversation reads as non-resumable and does nothing on click.
4. Collapse the sidebar and resize it, restart → width + collapsed state remembered.
5. Drag a row into a specific pane.

---

## Git discipline

Branch `feature/s4-projects-sidebar` off `develop` after approval. Commits on the feature branch only; no direct commit to `develop`, no push, no merge without explicit say-so. No AI-attribution trailer.
