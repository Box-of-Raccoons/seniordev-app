# S7: Conversation titles, teardown suppress, splash click-to-dismiss

Status: draft, awaiting approval
Date: 2026-07-30
Branch to create (off `develop`): `feature/s7-titles-suppress-splash`
Baseline: `develop` at `92c3018` (S5+S6 pushed), **732 tests**, typecheck + build clean. Confirmed by a real `pnpm test` as Step 0.
Design source of truth: `DESIGN.md`, `PRODUCT.md` (splash + dialog UI bind).

Stakes read: **medium-blast, reversible.** Feature A adds a store field + a post-hoc title backfill (touches the persistence read/write path, so the most careful part). B and C are small and isolated. No change to the pty/spawn/worktree/sync contracts.

Hardy's calls (2026-07-30): title from the **transcript first message** (all agent sessions); suppress flag in the **workspace prefs store**; suppression **still asks when a worktree exists**.

---

## Evidence grounded in the code + real files (read, not inferred)

| Claim | Where |
| --- | --- |
| Transcript file locations + JSONL scanning already exist | `session-resumable.ts`: `claudeHasTranscript` (`~/.claude/projects/*/<id>.jsonl`), `codexRolloutHasContent` (codex rollout, `event_msg`/`user_message`) |
| **claude** first user message shape (verified on a real file) | `{type:'user', isMeta?, message:{role:'user', content: string \| [{type:'text',text}]}}`; the first lines can be `<local-command-caveat>`/meta, so skip `isMeta` and content starting with `<` |
| **codex** first user message shape (verified on a real rollout) | line `{type, payload:{type:'user_message', message:"say 'bonjour'"}}` — text is `payload.message` |
| Conversation title is set at spawn from the tab title (`req.title` → `onAgentSpawn` → `conversations.upsert`); task launches already encode the input, bare/instant launches produce `session · <project>` / `<project> · <tool>` | `RightPanel.launch`, `sidebar-logic` `openSessionTabSpec`/`composerTabSpec`, `session-persistence.onAgentSpawn` |
| `conversations-store` has `setAgentSessionId`/`setArchived` but no `setTitle`; migrate-on-read tolerates new fields | `conversations-store.ts` |
| The codex id poll (`pollForCodexSession`) is the established "poll a transcript from spawn" pattern to mirror for a title poll | `session-persistence.onAgentSpawn` + `codex/session-discovery.ts` |
| `workspace-store` (workspace.json) is the runtime-prefs store: `WorkspaceDoc`, migrate-on-read, atomic debounced writes; read to the renderer via `workspace:getSidebar` → `SidebarState` | `store/workspace-store.ts`, `ipc.ts` `WORKSPACE.getSidebar`, `sidebar-handlers.ts` |
| The teardown dialog + skip point: `WorktreeTeardownDialog` (confirm emits `{removeWorktree}`); the sidebar's `openTeardown` opens it | `WorktreeTeardownDialog.vue`, `Sidebar.vue` `openTeardown`/`confirmTeardown` |
| Splash lifecycle already exposes `hide()`; App uses only `visible`+`ready`; the splash has a `.splash__loader` bar and `role="status"` | `useSplash.ts` (`return { visible, ready, hide }`), `App.vue:27`, `Splash.vue` |

---

## Decisions I'm making (low-blast — stated, not asking)

- **Projects keep their folder-basename name** ("code"). A project's identity is its folder; the real fix is per-conversation titles. Not changing project naming.
- **Task-launch titles are preserved.** A SeniorDev task launch's transcript first message is the *expanded* prompt (role template + request), which is a worse title than the user's own input. So: a conversation carries an `autoTitle` flag — `false` when the launch had a user prompt (title is already meaningful), `true` for bare/instant launches. The title backfill only retitles `autoTitle === true` conversations, and flips the flag to `false` once it sets a real title (stable, runs once).
- **Raw terminals stay generic** ("shell · project") — no transcript, not persisted as conversations.
- **Suppress reset** this slice is via editing workspace.json (or turning it back on from a future settings toggle) — flagged as a follow-up, not built now, since "don't ask again" is rarely reversed.
- **Splash click bypasses `minVisibleMs`** (that is "close it faster"); revealing the app mid-startup is fine (the workbench is usable and startup finishes async).

---

## Steps (each with its own gate; gates report a delta vs 732)

0. **Baseline.** `pnpm test` + typecheck on clean `develop`. **Gate:** 732 green recorded.

### Feature A — conversation titles from the first message

1. **Pure extractor + summarizer.** In `session-resumable.ts` (or a new `session-title.ts` reusing its dir helpers): `firstUserMessage(conv) → string | null` (claude: first non-`isMeta` `type:'user'` line whose `message.content` yields non-empty text not starting with `<`; codex: first `user_message` payload's `message`) and `summarizeTitle(text) → string` (first non-empty line, whitespace-collapsed, truncated ~50 chars). Every failure mode → `null` (leave the title).
   **Gate:** unit tests against fixture JSONL lines for both agents incl. the skip-meta/`<...>` and content-array cases; typecheck; `732 + N`.

2. **Store: `setTitle` + `autoTitle`.** `conversations-store`: add `autoTitle: boolean` (migrate default `true`), a `setTitle(id, title)` that also clears `autoTitle`, and honor an `autoTitle` field on `ConversationUpsert`.
   **Gate:** store tests (setTitle updates + clears autoTitle; upsert sets autoTitle; migration defaults true); typecheck; delta.

3. **Persistence: set the flag at spawn + backfill titles.** `onAgentSpawn` sets `autoTitle = !hadPrompt` (thread `hadPrompt: !!req.input` from `terminal-handlers`). Add `backfillTitles()` — for each `autoTitle` conversation, `firstUserMessage` → `setTitle` → `emitChange`; run it on the existing triggers (startup, `onTabExit`, after codex id discovery) **and** a bounded post-spawn poll for the just-spawned bare conversation (mirroring `pollForCodexSession`, so the title fills in live within seconds, then stops). All degradations leave the generic title.
   **Gate:** persistence tests (autoTitle set from hadPrompt; backfill retitles only autoTitle convs and flips the flag; a task-launch title is never overwritten; injected fake extractor so no real files); typecheck; delta. Sidebar already renders `conversation.title`, so no sidebar change.

### Feature B — "Don't ask again" on teardown

4. **Prefs flag + IPC.** `workspace-store`: `suppressTeardownConfirm: boolean` (migrate default false) + a setter; extend `SidebarState` (`workspace:getSidebar`) to return it, and add `workspace:setSuppressTeardownConfirm` (or fold into the teardown IPC). Preload methods.
   **Gate:** store + handler tests; typecheck; delta.

5. **Dialog checkbox + sidebar skip.** `WorktreeTeardownDialog`: a "Don't ask again" checkbox, shown **only when there is no worktree** (worktree cases always confirm, per the scope call). On confirm with it checked → persist the flag. `Sidebar.openTeardown`: if the flag is set **and** the conversation has no worktree → archive immediately (`teardownConversation({removeWorktree:false})`), skipping the dialog; otherwise show it. Read the flag on mount + on `sidebar:changed`.
   **Gate:** dialog test (checkbox only without a worktree; confirm carries the suppress choice); sidebar test (flag + no worktree → no dialog, archives; flag + worktree → dialog still shows); typecheck; **on-device**; delta.

### Feature C — splash click-to-dismiss

6. **Click / key to continue.** `Splash.vue`: make the overlay an interactive dismiss target (click + Enter/Space/Escape), `role="button"`, `aria-label="Click to continue"`, focus it on mount; replace the `.splash__loader` bar with a static "click to continue" hint in the splash ink; emit `dismiss`. `App.vue`: destructure `hide` from `useSplash` and wire `@dismiss="hide"`. Reduced-motion already covered (the new hint is static).
   **Gate:** `Splash` test (emits dismiss on click and on keydown; renders "click to continue", no loader); `useSplash` `hide` already tested; typecheck; **on-device**; delta.

7. **Final gate + report + DESIGN pass.** Full-suite delta vs 732; typecheck; build; DESIGN walk (dialog checkbox focus/AA; splash contrast on cream + reduced-motion + a visible focus state on the now-interactive splash; no em-dashes). **No commit / merge / push without your say-so.**

---

## Things easy to get wrong (flagged)

- **Don't clobber a good title.** The `autoTitle` guard is what stops a task launch's clean input title being overwritten by the verbose expanded-prompt transcript line. Load-bearing — tested explicitly.
- **Title timing.** The transcript only has the first message after it's sent+persisted; the bounded poll fills the title in shortly after, not instantly. A title that never arrives (nothing ever typed) correctly stays generic.
- **Transcript field names are an internal contract** of each CLI (same coupling class as the existing resume/discovery code); verified against real files today, and every parse failure degrades to "leave the title".
- **Suppress + worktree:** the checkbox must not appear (or must be inert) when a worktree exists, or a user could silently suppress a destructive-removal decision — the scope call is "always ask when a worktree exists".

## On-device (yours to verify)

1. Start a bare "New Session", type a first message → the tab/sidebar retitles to a summary of it within a few seconds; a Task launch keeps its prompt-based title.
2. Archive a no-worktree conversation, check "Don't ask again" → subsequent no-worktree archives skip the dialog; a worktree conversation still prompts.
3. Click the splash (or press a key) → it closes immediately; it reads "click to continue".

## Git discipline

Branch off `develop` after approval. Commits on the feature branch; no direct commit to `develop`, no push, no merge without explicit say-so. No AI trailer; no em-dashes in shipped copy.
