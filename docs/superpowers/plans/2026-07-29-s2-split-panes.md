# S2: Split panes and tab dragging — implementation plan

Status: approved, in progress
Date: 2026-07-29
Branch: `feature/s2-split-panes` (off `develop`)
Baseline: `develop`, clean tree, **69 test files / 496 tests passing**, typecheck clean.
Design source: `docs/superpowers/specs/2026-07-28-seniordev-workspace-epic-design.md` §6 (also §3 ordering, §10.1 risk).
Visual source of truth: `DESIGN.md`, `PRODUCT.md`.

## Locked decisions

- **Columns only.** No vertical splits, no nested grid.
- **Per-pane tab strips, no split button.** Each pane owns its own tab strip and `+` menu.
  New panes are created only by dragging a tab to the window edge (mouse) or the keyboard
  edge-move.
- **Draggable resize splitters** between panes, clamped to `minPaneWidth`. Resize re-runs the
  xterm fit addon and pushes `pty:resize`.
- **Keybindings + DnD.** Pane ops are keyboard-operable (move active tab to next/prev pane and
  to a new edge pane), satisfying WCAG 2.1 AA operability. DnD is native HTML5, no new dep.
- `minPaneWidth` is a `config.yaml` key, default **320**.

## Model (`usePanes` composable — §6.4)

```
Pane    { id, widthFraction, tabs: LiveTab[], activeTabId }
LiveTab { ptyId, conversationId, title, kind, tool,
          + render fields today's Term carries:
            variant, initialMode, prefill, prompt, input, ticketKey, shell, resume,
            cwdOverride, exited }
```

- `ptyId` = today's `t.id` (keeps `t${counter}-${Date.now()}`), so every IPC call and the S1
  status key are untouched.
- `conversationId` minted at tab creation via `crypto.randomUUID()` from Step 1, unused until S3
  (§3 ordering constraint — prevents S2's model needing rework).
- **Status is not folded into the pane model.** S1's `statuses` record stays keyed by `ptyId`
  in `RightPanel`; each pane strip renders `StatusGlyph :status="statuses[tab.ptyId]"`. A dragged
  tab keeps its `ptyId`, so its glyph follows it. Notification wiring stays in `RightPanel`,
  taught pane-awareness only for the §5.5 "active in focused pane" suppression rule.

## Scrollback survival (§6.3)

Every tab's content renders once in a single flat `v-for` keyed by `ptyId`, each wrapped in
`<Teleport :to="[data-pane-slot=<paneId>]">`. Each pane renders that target div. Moving a tab
changes `tab.paneId` → the teleport target changes → the DOM node relocates without unmounting.
No xterm `.open()` re-entry; buffer intact. Panes render before the teleport list; teleport is
`:disabled` until an `onMounted` flag flips, so targets always exist first.

## Steps (each with its own gate)

1. **`usePanes.ts` (pure, no DOM).** Model + mutations: add / close / focus / moveTab (within &
   between panes) / moveToNewPane(side) / moveActiveToAdjacentPane / resize (clamped, adjusts
   pane + neighbor) / equal-width redistribution on add/remove / empty-pane cleanup (last pane
   stays, shows empty state). `conversationId` minted here.
   **Gate:** new `usePanes.test.ts` green; typecheck; full suite 496 + N new.

2. **Refactor `RightPanel` to a single pane via `usePanes` + the flat Teleport list.** No
   multi-pane UI yet. Preserves the `newTab/openComposer/startStartupSession/closeAll/hasSessions`
   surface App.vue calls. Includes a jsdom check that VTU finds a `.tv` teleported into an
   in-component target.
   **Gate:** existing `RightPanel.test.ts` green (additive tweaks only, justified); full suite;
   typecheck. On-device: terminals/yolo/composer, status glyphs, notifications still work in one
   pane (no S1 regression).

3. **Teleport-move on device (§10.1 gap).** Enable a second pane and move a live terminal between
   panes of different widths; confirm scrollback survives, fit re-runs, `pty:resize` fires. Add an
   explicit refit nudge only if the `ResizeObserver` in `TerminalView` doesn't fire on a teleport
   move (decided by observation).
   **Gate:** on-device observation + a renderer unit test for any refit trigger added.

4. **Multi-pane layout + resize splitters.** Panes `v-for` with per-pane tab strip + `+`;
   draggable splitter clamped to `minPaneWidth`; equal-width redistribution. Plumb `minPaneWidth`:
   additive `ConfigSchema` key (default 320) + small `getWorkspaceSettings` IPC + preload
   accessor, re-fetched on `onConfigChanged`.
   **Gate:** `usePanes` resize tests; schema test green (additive); full suite; typecheck;
   on-device resize drives fit + `pty:resize`.

5. **Drag-and-drop (native HTML5 DnD).** Draggable tabs; drop to reorder within a pane, onto
   another pane's strip to move, onto the window edge to create a pane.
   **Gate:** `usePanes` move tests; renderer test that drop handlers call the right
   `moveTab`/`moveToNewPane`; on-device drag test.

6. **Keyboard pane ops + focus states.** Keybindings to move the active tab to next/prev pane and
   to a new edge pane. Visible focus on every control.
   **Gate:** keybinding handler unit test; full suite; typecheck; on-device keyboard test.

7. **Final gate + report.** Full-suite delta vs 496; typecheck; on-device smoke of all paths;
   DESIGN/PRODUCT compliance pass (no color-only state, tonal steps not stripes,
   `prefers-reduced-motion`, focus states, AA contrast, no em-dashes in UI copy).
   No commit / merge / push without explicit say-so.

## Risks watched

- Whether VTU finds teleported content in the existing tests — Step 2 micro-check settles it.
- Whether the `ResizeObserver` alone re-fits after a teleport move — Step 3 settles it on device.
