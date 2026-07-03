# Trigger SeniorDev from Jira — deep link, bookmarklet, and Jira Orchestrator

Date: 2026-07-03
Status: approved (user: "build autonomously")

## Summary

One click on a Jira issue launches SeniorDev against that ticket. A bookmarklet
navigates to a `seniordev://` deep link; the app opens (or focuses), loads the
ticket, asks for confirmation, then runs a built-in **Jira Orchestrator** — a
two-stage flow that classifies the ticket against the prompt library and
launches the best-matching prebuilt prompt as a normal YOLO run.

Decisions made during brainstorming:

- **Full trigger via a built-in router prompt** — the Jira-side button stays
  dumb (one URL, no prompt-list syncing); routing intelligence lives in-app.
- **Two-stage (classify then spawn)**, not one-shot: a short classifier run
  outputs a prompt name as JSON; the app then launches that prompt verbatim.
  Deterministic — the chosen prompt runs exactly as written.
- **Bookmarklet only** on the Jira side (no browser extension, no Forge app).
- **In-app confirm dialog** before any deep-link-initiated YOLO run —
  non-optional in code, because any webpage can navigate to `seniordev://`.

## 1. Protocol handler (app side)

- Register `seniordev://` with the OS via `app.setAsDefaultProtocolClient`.
  Dev-mode on Windows needs the variant with `process.execPath` and the
  resolved app path argument. Add a `protocols` entry to `electron-builder.yml`
  so packaged installs register it too.
- Two URL forms:
  - `seniordev://open?ticket=SD-6` — open/focus app, load ticket. No gate.
  - `seniordev://yolo?ticket=SD-6` — load ticket → confirm gate → orchestrator.
- Add `app.requestSingleInstanceLock()` (missing today; quit the second
  instance). A second launch forwards its argv to the running instance
  (`second-instance` event on Windows/Linux, `open-url` on macOS), which
  focuses the window and pushes a new `deeplink` IPC event to the renderer.
- Cold start (app not running): the URL arrives in `process.argv` and is parsed
  alongside existing CLI flags in the startup-options path.
- New pure module `src/main/deeplink/parse.ts` (+ tests) maps a URL to
  startup-session-shaped data. Ticket keys validated against the same
  `[A-Za-z][A-Za-z0-9]*-\d+` pattern `parse-args.ts` uses; anything malformed
  is rejected with a warning, never partially applied.

## 2. Confirm gate (renderer)

On a `yolo` deep link the renderer opens the ticket tab, then shows the
existing Confirm dialog: "Run Jira Orchestrator on SD-6 — ⟨summary⟩?".
Decline = ticket stays open, nothing runs. This gate is hard-coded, not a
config flag: it is the only thing between a drive-by `seniordev://yolo` link on
a malicious page and an autonomous agent run with bypassed approvals.

## 3. Jira Orchestrator — built-in prompt, two-stage run

**Built-in prompt.** The orchestrator prompt text ships as a preset in
`presets.ts` (like `DEFAULT_YOLO_RECAP`), so it cannot be deleted. If a
`jira-orchestrator.md` exists in the prompts dir it overrides the built-in;
deleting that file reverts to the built-in rather than removing the prompt.
Prompt Config shows a "built-in (customized)" badge instead of a Delete button.

**Stage 1 — classify.** A headless run (existing spawner/parser plumbing)
whose prompt contains the ticket context plus a catalog of prompt **names +
descriptions**, instructing: answer with only a JSON object —
`{"prompt": "<name>"}` choosing the best playbook, or
`{"prompt": null, "reason": "..."}` if none fits — and do not modify any
files. The app extracts the JSON from the final output.

**Stage 2 — spawn.** On a valid name, launch a normal YOLO run with that
prompt verbatim — existing `StartYoloRequest` path; tab UI, PR cards, Stop
button, and resume all unchanged. The tab header shows the routing:
`Jira Orchestrator → fix-bug`.

**Failure handling.** Classifier exits non-zero, returns garbage, names a
nonexistent prompt, or answers `null` → no stage 2. The tab shows the
classifier log and the reason; the ticket stays open so the user picks a
prompt manually. Never guess-and-run.

New module `src/main/orchestrator/` owns the stage-1 prompt build, JSON
extraction, and classify→spawn sequencing; tested with a fake spawner.

## 4. Bookmarklet (Jira side)

A one-liner bookmark that extracts the issue key from the Jira URL
(`/browse/SD-6`, or `selectedIssue=SD-6` on board/backlog views) and sets
`location.href = 'seniordev://yolo?ticket=' + key`; alerts if no key is found.
A second `open`-only variant is included for free. Both documented in the
README. First click per browser shows the one-time OS "Open SeniorDev?
☑ Always allow" prompt — that is the entire browser integration.

## Acceptance criteria

- `seniordev://open?ticket=X` opens/focuses the app with ticket X loaded —
  cold start and already-running both work.
- `seniordev://yolo?ticket=X` additionally shows the confirm dialog; accept
  runs classify→spawn; decline leaves the ticket open with no agent run.
- Only one app instance ever runs; a second protocol launch focuses the
  existing window instead of opening a new one.
- Classifier failure/no-match never launches stage 2 and surfaces the reason
  in the tab.
- `jira-orchestrator` appears in the prompt list, cannot be deleted (built-in
  fallback), and a user file with that name overrides it.
- The bookmarklet extracts the key on both issue-view and board/backlog URLs.
- Existing CLI startup flags, interactive sessions, and plain YOLO flows are
  unchanged, verified against the recorded test baseline.

## Out of scope

- Browser extension and Jira Forge app.
- Passing a specific prompt name via the URL (the protocol's query params
  leave room; nothing consumes them in v1).
- Flag-enforced read-only classifier (`classifyArgs` per tool) — v1 runs the
  tool's existing `headless.args`, with read-only behavior prompt-enforced.
  Follow-up candidate.

## Integration notes (develop @ 5ee47ae)

Two features landed on develop after this design was drafted and constrain the
implementation:

- **SD-6 `yoloPreamble`/`yoloRecap`:** `buildHeadlessLaunch` now wraps every
  headless prompt as `preamble + prompt + recap`. The stage-1 classifier must
  NOT use that wrapping — the recap ("end with ## Changes made / ## Pull
  requests") directly contradicts "answer with only a JSON object", and the
  preamble's "work the task to completion" framing is wrong for a classify-only
  turn. The orchestrator builds its own stage-1 launch (same spawner/parser,
  no preamble/recap). Stage 2 is a normal YOLO run and keeps both.
- **SD-4 seeded role prompts:** `resources/prompts/` ships a role library
  seeded copy-if-missing into the user's promptsDir on boot. The classifier
  catalog is built from `loadPrompts` output, so it automatically includes the
  role library plus any user prompts. The orchestrator's own prompt stays a
  `presets.ts` built-in (recap/preamble-style, file-override, non-deletable) —
  it is routing machinery, not a playbook, and must never appear in its own
  catalog.

## Known caveat

The classifier runs with the tool's existing headless flags (for claude,
`--permission-mode auto`), so "do not modify files" is prompt-enforced, not
flag-enforced, in v1. The confirm gate bounds the exposure: no classifier runs
without an explicit in-app yes.
