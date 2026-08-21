# Scheduled Prompts

Design spec, 2026-08-21.

## Problem

SeniorDev delivers a prompt into a session exactly once: at spawn. There is no
way to say "send this later." Three situations want one.

A session that hits a usage limit at 1am sits dead until a human comes back to
it, wasting the whole overnight window even though the limit resets at 5am. A
prompt you want to run on a rhythm (poll a build, re-check a branch, nudge a
long-running agent) has to be retyped every time. And work you want started
fresh on a cadence has no home at all: the composer only launches now.

## Use cases

1. **Resume after a usage limit.** A live conversation is wedged. Schedule one
   prompt ("continue") to land at 5:00, unattended.
2. **Recurring into an existing conversation.** The same prompt into the same
   conversation every N minutes, or daily at a wall-clock time.
3. **Recurring into a new session.** Folder, role, and prompt, launched fresh on
   a cadence, touching no existing session.

## Non-goals

- **Cron expressions.** `once`, `every`, and `daily` cover every case above. A
  parser adds a dependency, a parse-error surface, and a UI that has to explain
  `0 5 * * *`. Add a fourth trigger variant when a real need appears.
- **Running while the app is closed.** Schedules live in the main process and
  fire only while SeniorDev runs. An OS-level trigger (launchd, Task Scheduler)
  is two platform integrations for a case the maintainer does not have: both
  machines stay awake with the app open.
- **Schedules in `config.yaml`.** A declarative block is attractive for the
  standing recurring schedules, but wrong for use case 1, which is inherently
  ad hoc. Revisit once the recurring set proves stable enough to want in version
  control.

## Data model

One new store, `schedules.json`, built on the existing `createJsonStore` and
migrate pattern in `src/main/store/json-store.ts`. Version 1. Kept separate from
`workspace.json` (hot), `conversations.json` (warm), and `projects.json` (cold);
its write frequency is warm, one write per firing.

```ts
export interface Schedule {
  id: string
  enabled: boolean
  title: string                    // label in the UI; derived from prompt when blank
  target:
    | { kind: 'conversation'; conversationId: string }
    | { kind: 'launch'; cwd: string; tool: string; role: string; worktree: boolean }
  prompt: string                   // injected text, or the launch's seed prompt
  trigger:
    | { kind: 'once';  atMs: number }
    | { kind: 'every'; intervalMs: number; notBeforeMs: number | null }
    | { kind: 'daily'; hour: number; minute: number }   // LOCAL wall time
  catchUp: boolean
  maxFirings: number | null        // null permitted only for kind 'once'
  stopOnFailure: boolean
  // run state
  firedCount: number
  nextDueAt: number
  lastFiredAt: number | null
  lastOutcome: 'fired' | 'deferred' | 'skipped' | 'missed' | 'failed' | null
  lastReason: string | null        // why it skipped or failed, in plain language
  createdAt: number
}
```

### Decisions inside the record

**A `conversation` target holds a `conversationId`, never a tab id.** Tab ids are
per-launch. A conversation survives the tab closing and the app restarting, which
use case 1 requires: the wedged tab may well be closed before 5am.

**`daily` stores hour and minute, not an absolute timestamp.** `nextDueAt` is
recomputed from local date components on each firing, so 5am stays 5am across a
DST shift. Storing an interval would drift to 4am or 6am twice a year, on exactly
the unattended overnight runs where nobody would notice.

**`notBeforeMs` on `every` is an earliest-start, not a fire-at.** It holds the
first moment a firing is permitted, after which the interval runs normally. It is
what expresses "every 30 minutes, but not before 5am." `null` means the interval
starts from `createdAt`.

**`maxFirings` is nullable only for `once`.** Every recurring schedule carries a
firing cap. The guard belongs in the record, not in a confirmation dialog at
creation time: recurring plus YOLO is an unbounded burn, and a dialog does not
bound it.

## Architecture

Pure core, impure edge, matching the existing split between
`terminal/status.ts` (pure state machine) and `terminal/status-hub.ts`
(orchestration).

| Module | Role |
| --- | --- |
| `schedule/schedules-store.ts` | Versioned JSON store. Mirrors `conversations-store.ts`. |
| `schedule/scheduler.ts` | **Pure.** `dueNow(schedules, nowMs)`, `advance(schedule, outcome, nowMs)`, `nextDueAfter(trigger, fromMs)`. No Electron, no timers, clock injected. |
| `schedule/runner.ts` | Owns one interval. Asks the store, calls the pure core, dispatches to an injected `ScheduleExecutor`, writes outcomes back. |
| `ipc/schedule-handlers.ts` | Renderer CRUD, plus executor wiring. |

**The scheduler runs in main, not the renderer.** `src/main/index.ts:118` sets
`webPreferences` without `backgroundThrottling`, so it defaults to `true` and
Chromium clamps timers in a hidden or occluded window. A renderer-side timer
would fire the 5am resume whenever the window was next focused, which is the one
behavior the feature cannot have. The main process has no such throttling.

**One ticker, wall-clock comparison, not one timer per schedule.** The runner
holds a single 15s interval and compares `nextDueAt` against `Date.now()`. Long
`setTimeout` values drift, and a wall-clock comparison handles a clock change, a
DST jump, and a window missed while the app was down through the same code path.

**Two of the three delivery paths need the renderer.** Injecting into a live tab
happens entirely in main, through the existing `deliverPromptWhenReady`
(`src/main/ipc/terminal-handlers.ts:99`), which already gets ConPTY readiness and
the separate Enter keystroke right. Launching new, and resuming a closed
conversation, both need a *tab*, which is renderer state; both go out through
`WarmDelivery` (`src/main/deeplink/delivery.ts`), already generic and already
serving deep links and warm CLI sessions, including its behavior of summoning a
window when none exists.

## Fire decision

The safety gate is already computed. `src/main/terminal/status.ts:57-63` derives
`idle` and `needsYou` from the same quiet event, split only by whether the
settled buffer matched the tool's `approvalPatterns`. `needsReview` and `failed`
are terminal states: the process has exited, so there is no pty to write to.

For a `conversation` target, in order:

| Situation | Outcome |
| --- | --- |
| Conversation archived or missing | `failed`, schedule disabled, reason recorded |
| Live pty, status `idle` | **fire** via `deliverPromptWhenReady` |
| Live pty, status `working` | `deferred`, retry next tick |
| Live pty, status `needsYou` | `skipped` and notify. Never inject. |
| No live pty (closed, `failed`, or `needsReview`) | resumable per `session-resumable.ts`? Relaunch with the agent's resume id and seed the prompt. Not resumable? `skipped`. |

**`needsYou` must never inject.** A `needsYou` tab is sitting on an approval
prompt. Text written into it lands in the confirm, and the trailing `\r` answers
a question the human never read. This is the single most dangerous behavior the
feature could have, and it is why the gate reads live status rather than assuming
a session is receptive.

**Deferral has a deadline.** A tab that stays `working` past `DEFER_WINDOW_MS`
(a module constant in `scheduler.ts`, 30 minutes, not per-schedule in version 1)
becomes `skipped`, not deferred indefinitely. Without it, a
daily schedule aimed at a busy session silently never runs, and the failure is
invisible for days.

A `launch` target has no gate: it touches no existing session, so it fires
whenever due.

## Failure handling and catch-up

- An executor that throws yields `failed` with the message in `lastReason`. When
  `stopOnFailure` is set, the schedule disables itself.
- On app start, any enabled schedule whose `nextDueAt` is in the past is
  `missed`. `catchUp: true` fires it once, then advances. `catchUp: false`
  records the miss and advances to the next future occurrence.
- **Catch-up fires at most once, never a burst.** A recurring schedule that was
  down for ten intervals runs one time on recovery. Ten firings at once would
  drain a usage limit in a minute.
- A firing is never silently dropped. Every outcome, including `missed`, is
  written to the record and visible in the UI.
- Notifications reuse `status-notify.ts` and fire on `skipped` and `failed`
  only. A routine `fired` is silent, or the recurring schedules become spam.

## UI

**Creating a `launch` schedule reuses the Composer.** Launch grows a sibling
action, Schedule. Same surface, same validation; it stores the composer state as
a `Schedule` rather than spawning. A scheduled launch is a saved composer.

**Creating a `conversation` schedule is an action on the tab.** Use case 1 is
"staring at a wedged session," so it is a tab context-menu item plus a
keybinding, opening a small `ModalShell` dialog: the prompt, and when. Bound to
that conversation already.

**A pending schedule is visible on its tab.** A small clock affordance on the tab
and sidebar row when a schedule targets that conversation, with the next fire
time on hover. Something that will type into a session at 5am does not belong
only inside a modal ("show the work, always").

**The full list lives in `SchedulesModal.vue`**, alongside `AppConfigModal` and
`PromptConfigModal`: every schedule, its next fire time, its last outcome and
reason, and enable, disable, or delete. `RightPanel.vue` was considered and
rejected: the panel is per-session, and `launch` schedules belong to no session.

Per DESIGN.md and the accessibility target, the clock affordance carries a text
label or title, never color alone, and honors `prefers-reduced-motion`.

## PRODUCT.md amendment

Design principle 2 currently reads:

> **Never guess-and-run.** The human launches every run: a deep link only
> prefills the composer, it never auto-runs.

Its purpose is to make an *unauthored* run impossible, above all an accidental
YOLO run. A schedule the developer wrote in this app is authored; it is the
launch, deferred. The wording is amended to say so:

> **Never guess-and-run.** The human authors every run. A deep link only
> prefills the composer, never launches it; a schedule runs only what the
> developer wrote into it, here, in this app. Nothing outside SeniorDev can
> start a run, least of all a YOLO one.

The same amendment applies to the abbreviated principle list in CLAUDE.md.

## Testing

The pure core carries the weight, since it takes an injected clock:

- `scheduler.test.ts`: due computation per trigger kind; `daily` holding 5am
  across a DST boundary; catch-up firing exactly once after a ten-interval
  outage; `maxFirings`; `stopOnFailure`; missed versus deferred; the deferral
  deadline.
- `runner.test.ts`, with a fake clock, store, and executor: one test per row of
  the fire-decision table. "`needsYou` never injects" is its own named test.
- `schedules-store.test.ts`, mirroring `conversations-store.test.ts`, including a
  malformed-record migrate case.
- `SchedulesModal.test.ts`, and a Composer test for schedule mode.

Prompt delivery itself is already covered by the existing `terminal-handlers`
tests and is not re-tested here. No new dependencies.

The full suite's pass and fail counts are recorded before the first edit, so the
closing "no regressions" claim is a diff against a real baseline.

## Risks

**Unverified assumption, load-bearing for use case 1.** This design assumes a
rate-limited claude sits quiet with a message that does not match
`approvalPatterns`, so the tab reads `idle` and its composer accepts text. If it
instead reads `needsYou`, the schedule correctly refuses to fire and the feature
no-ops in precisely the situation it was built for. Settling it requires
observing a real usage limit: leave the tab open and note the glyph. If the
assumption is wrong, the fix is a tool-specific "limit reached" pattern that
resolves to a fourth disposition, receptive but not idle.

**Delivery timing is inherited, not re-derived.** `QUIET_MS` (700) and
`SUBMIT_DELAY_MS` (300) in `terminal-handlers.ts` were tuned against live CLI
behavior. A scheduled injection into an established session is a different
runtime state from a delivery into a freshly booted TUI, and the constants may
not transfer. Verify a scheduled injection against a real session before calling
the feature done.
