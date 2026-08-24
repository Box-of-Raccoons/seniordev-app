# The Supervision Epic

Design doc, 2026-08-23. Six features that close the same gap: SeniorDev can
launch and resume agent sessions, but it gives you almost nowhere to see what
those sessions actually did.

PRODUCT.md says the app exists for "supervised, one-launch agent runs, without
ever hiding what the agent is doing." Launching is built. Supervision is not.
Today the app can spawn four agents into four worktrees and offers no way to read
their diffs, no way to run the project's own gate against their work, no way to
see what a session cost, no way to search what was said, and no single list of
which sessions are waiting on you.

## What ties these six together

Five of the six are **readers of data that already exists on disk**. Only one
executes anything.

| Slice | Source of truth | Executes? |
|---|---|---|
| Diff review | git working tree / worktrees | No |
| Gate runner | the project's own test command | **Yes** |
| Cost meter | agent transcripts (`usage` records) | No |
| Transcript search | the same transcripts | No |
| Blocked-session inbox | in-memory session status | No |
| Log tailer | a file the user names | No |

That shapes the architecture. Most of this epic is a read-only observation layer
in main that watches sources the app already knows how to locate, plus pure
parsing modules in the renderer, plus one feature that spawns a child process.

Two facts confirmed while writing this, both load-bearing:

1. **The app already reads agent transcripts.** `src/main/session-title.ts`
   parses claude `.jsonl` files and codex rollouts, locating them through
   `claudeProjectsDir` (session-resumable.ts) and `codexSessionsDir`
   (codex/session-discovery.ts). The cost meter and transcript search are new
   readers over files the app already opens.
2. **Both transcript formats carry token usage.** Claude writes a per-message
   `usage` object (`input_tokens`, `output_tokens`, `cache_read_input_tokens`,
   and `cache_creation` split into `ephemeral_1h_input_tokens` /
   `ephemeral_5m_input_tokens`), with `model` on each message and an
   `isSidechain` flag on the record. Codex writes a cumulative
   `total_token_usage` (`input_tokens`, `cached_input_tokens`,
   `cache_write_input_tokens`, `output_tokens`, `reasoning_output_tokens`).
   Verified by reading real files on this machine, 2026-08-23.

## The surface constraint

DESIGN.md is hostile to most of the obvious answers here, deliberately:

- "The app has two core surfaces, and neither is a panel."
- "Don't build a generic SaaS dashboard: no card grids, hero-metric tiles, or
  gradient accents."
- "Don't pile on heavy IDE chrome: no cluttered toolbars, deeply nested panels."
- "Modal is the last resort."
- "State is never conveyed by color alone."

A naive read of these six features produces exactly the thing DESIGN.md bans: a
metrics tile for cost, an inbox panel, a diff pane, a log pane. So the surface
plan is deliberately conservative:

**Four of the six need no new surface at all.** The cost meter, the gate result,
and the blocked-session inbox attach to surfaces that already exist (the sidebar
rows, the tab strip, `StatusGlyph`). The log tailer is a variant of the Terminal
tab that already exists.

**Two introduce new UI, and both use an idiom the app already has.** Diff review
becomes a tab, because a tab is this app's unit of work. Transcript search
becomes a keyboard-summoned overlay, which is the keyboard-first behavior
DESIGN.md asks for and is a different thing from the config-editor modals it
warns against.

One honest tension to record: DESIGN.md's "neither is a panel" line is already
out of date. `Sidebar.vue` and `SubagentPanel.vue` both exist and both ship. The
spirit of the rule (do not become an IDE) still holds and this epic respects it,
but the letter should be updated rather than quietly ignored.

---

## Slice 1: Diff review

**The gap.** `src/main/git/git-runner.ts` and `worktree-service.ts` exist in
main. There is no review component anywhere in `src/renderer/src/components`.
The app can put four agents in four worktrees and then shows you none of their
work.

This is the largest slice and the one that most directly serves the product
thesis. Human review is the actual bottleneck in agentic development. Agent
throughput is not.

**Surface.** A new tab type, opened from a session's status line or from a
sidebar project row. It follows the composer's existing morph pattern: the tab
is the surface, not a pane bolted to the side of one.

Two levels:

- **Overview**: every session with uncommitted changes, one row each, showing
  branch, files changed, and insertions/deletions. This is the view that pays
  for the whole slice, because it is the one place you can see all parallel work
  at once.
- **Detail**: a unified diff for one session, rendered in Consolas per DESIGN.md's
  mono rule.

**Rendering constraint.** Additions and deletions are state, so green and rust
are the correct semantic colors. But "never convey state by color alone" means
the gutter must carry `+` and `-` marks independently of color. This is not
decoration; a red-green colorblind reader gets nothing otherwise.

**Scope for v1: read-only.** No staging, no committing, no discarding. Principle
5 in CLAUDE.md is "non-destructive by default," and a review surface that can
also throw work away is a different risk profile that deserves its own decision.
Committing from the app is a v2 question, explicitly deferred, not forgotten.

**Architecture.** A pure unified-diff parser (renderer, fully testable on
fixture strings) fed by an injectable git runner (main, already exists). No new
process, no new dependency.

**Open question for implementation.** Whether the overview reads all known
worktrees on demand or watches them. On-demand is simpler and cannot go stale;
measure it before adding a watcher.

## Slice 2: Gate runner

**The gap.** Nothing in `src/main` runs tests or a typecheck. Your own working
doctrine is that a worker's green run is evidence and not a substitute for
yours, and that gates get re-run at every phase boundary. The app gives that no
support at all.

**Trigger.** The idle detection built in S1 already emits exactly the right
signal. `status-matcher.ts` watches the rendered xterm buffer for stability and
emits `settled` when a session stops changing the screen. Running the gate on
`settled` rather than on a timer is what keeps it from firing mid-edit and
reporting a false red.

**Configuration.** The `repos:` list in config already carries `key`, `path`,
`branchPrefix`, and `forge` per repo. A `gate:` command belongs there, with a
per-project override in the projects store for folders that are not in `repos:`.
No gate configured means the feature is silently inert, which is the correct
default.

**Surface.** No new surface. A `StatusGlyph` variant plus a one-line result on
the tab. Full output is available on demand; it does not take over the screen.

**Safety.** This is the only slice that executes anything, and it executes a
string from a config file in a directory the user chose. Two guards: it runs
only in folders the user has already launched an agent into (the same trust
boundary the app already applies), and it runs in a child process, so a gate
that hangs or crashes cannot reach the ptys in main.

**Architecture.** A pure result module (exit code and output to pass/fail/error
state) behind an injectable command runner. The pure half is unit tested; the
spawn half is a thin wrapper.

## Slice 3: Per-session cost meter

**The gap.** claude-usage-watcher tells you the global number. What you cannot
see anywhere is that tab 3 burned twenty times what tab 1 did. Attribution is
the whole feature.

**Data.** Confirmed present in both formats (see above). Three details that
matter and are easy to get wrong:

1. **Model is per message, not per session.** A session that switches models
   must be priced per message or the number is wrong.
2. **Cache creation has two tiers.** `ephemeral_1h_input_tokens` and
   `ephemeral_5m_input_tokens` are priced differently. Collapsing them into one
   "cache write" number produces a quietly wrong total.
3. **`isSidechain` separates subagent spend from the main session.** For an
   orchestrator workflow this is not a nice-to-have. Knowing that the fan-out
   cost four times the orchestration is the actionable number.

**Pricing table lives in config, not code.** Model prices change and new models
ship. A hardcoded table becomes a lie on a schedule, and a cost readout that is
confidently wrong is worse than no cost readout. Bundle a default table, let
config override it, and show nothing for a model with no known rate rather than
guessing.

**This number is notional and must be labeled as such.** Work here runs on a Max
subscription, so the dollar figure is not a bill. It is the API-equivalent cost,
which is useful for comparing sessions against each other and useless as an
accounting figure. If the UI implies otherwise it is lying.

**Surface.** Deliberately small, because DESIGN.md bans hero-metric tiles. A
figure on the session's sidebar row and on the session record. No tile, no
gauge, no chart.

**Architecture.** A pure pricing function (usage record plus model to cost) and
a transcript usage reader that reuses the file-location code
`session-title.ts` already depends on. Both testable on fixtures with no disk.

## Slice 4: Blocked-session inbox

**The gap.** Per-tab state exists: `status-matcher.ts` detects settle,
`StatusGlyph.vue` renders it, `status-notify.ts` fires notifications. What is
missing is the aggregate. With one or two tabs you scan the strip. With eight
you hunt.

**Surface.** A section at the top of the existing `Sidebar.vue`. No new
component tree, no new panel.

**The distinction that makes it useful.** "Settled" currently means the screen
stopped changing. That covers two very different situations: a session waiting
at a prompt for your input, and a session that finished. Only the first belongs
in an inbox. Main already scans the settled buffer for a prompt, so the
information is probably present; confirming exactly what that scan produces is
the first implementation step, and if it does not distinguish the two cases,
that distinction is the real work of this slice.

**Architecture.** A pure aggregation function over session states. The smallest
slice in the epic.

## Slice 5: Transcript search

**The gap.** `archive.ts` and the conversations store mean the data is there and
indexed by project. "Which session did I fix that in" has no answer in the app.

**Surface.** A keyboard-summoned overlay, command-palette idiom. Type, see
matching sessions with the matching line in context, hit enter to open or resume
that session.

**Scope.** All sessions, including closed and archived ones. Searching only open
tabs would defeat the purpose.

**Architecture: start without an index.** On-demand scanning across transcript
files has no staleness problem and no cache to invalidate. Measure it at real
volume before building an index. If it turns out too slow, the index is a later,
informed decision rather than speculative infrastructure.

**Open question.** Whether search covers agent output or only user turns.
User-turn-only is a much smaller haystack and probably what "which session did I
do X in" actually means, but it would miss "which session hit that error."
Worth deciding from real use rather than up front.

## Slice 6: Log tailer

**Recommendation: do not build this yet.**

The motivation is sound. Your first debugging rule is to read the actual failure
output before forming a theory, and having the log beside the agent working on
it serves that. But SeniorDev already has raw Terminal tabs, and `tail -f
whatever.log` in one of them does the entire job today.

A tailer only earns its place if it adds something a Terminal tab cannot:
remembering the log path per project, opening automatically when the gate fails,
or highlighting error lines. Those are real, but they are also a thin layer on
top of a feature that already exists, and they are much more obviously worth
building once the gate runner exists to trigger them.

Keep this slice, sequence it last, and revisit it after Slice 2 ships. If the
answer then is still "I would just open a terminal," delete it from the epic.

---

## Ordering

Recommended: **Diff review first**, despite being the largest.

The temptation is to start with the inbox and the cost meter because they are
small and need no new surfaces. That is how the important thing never gets
built. Diff review is the slice that closes the gap between what PRODUCT.md
promises and what the app does, and it has the most open design questions, which
is exactly the argument for giving it the first detailed implementation plan
rather than the last.

After that, by a mix of value and cost:

1. **Diff review** (largest, highest value, most unknowns)
2. **Gate runner** (pairs directly with review: see the diff, run the gate)
3. **Cost meter** (small, self-contained, no new surface)
4. **Blocked-session inbox** (smallest, but only bites at high tab counts)
5. **Transcript search** (medium, wants real usage data to scope correctly)
6. **Log tailer** (revisit after the gate runner, or drop)

Slices 1 and 2 together form a coherent release: look at what the agent did,
then run the project's own gate against it. That is the supervision loop, and
neither half is much use without the other.

## Cross-cutting decisions

- **Read-only by default.** Only the gate runner executes, and it executes in a
  child process where a crash cannot reach the ptys in main.
- **No new panels.** Tabs, existing sidebar sections, and one keyboard overlay.
- **Degrade to nothing.** Every parse failure returns null and leaves the
  existing state untouched, matching the convention `session-title.ts` already
  established. A supervision feature that throws is worse than one that is
  quietly absent.
- **Pure core, injectable edges.** Every slice splits into a pure module tested
  on fixtures and a thin IO wrapper, which is the pattern the codebase already
  uses throughout.
- **Config over code** for anything that drifts: gate commands, model prices, log
  paths.

## Ruled out

- **A module or plugin system.** This epic was reached through a discussion of
  making these features installable modules. All six turned out to be core
  features rather than optional add-ons, so there is no contract to design and
  no loader to build. If a genuinely optional feature appears later (a Jira
  panel is the likeliest candidate, since it was cut from core for exactly the
  right reasons), the contract should be extracted from two real examples rather
  than designed against one imagined one.
- **Absorbing raccourier.** It stays a standalone notifier. Its localhost HTTP
  contract (`/notify`, `/messages`, `/health`, secret-authed) means SeniorDev
  could host it later if that ever becomes desirable, but there is no reason to.
- **Absorbing claude-usage-watcher.** It is a menu-bar app, and the point of a
  menu-bar app is not opening a window. The per-session cost meter here is a
  different feature that answers a question the global meter cannot.

## Open questions for the implementation plans

1. Does main's settled-buffer scan already distinguish "waiting at a prompt"
   from "finished"? (Slice 4 depends on the answer; Slice 2's trigger quality
   improves with it.)
2. Does the diff overview read worktrees on demand or watch them?
3. Does transcript search cover agent output or only user turns?
4. Where does the gate command live for a folder that is not in `repos:`?
