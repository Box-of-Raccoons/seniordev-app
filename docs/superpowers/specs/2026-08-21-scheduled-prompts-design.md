# Scheduled Prompts

Design spec, 2026-08-21. Reframed the same day: see "Scope correction" below.

## Problem

SeniorDev delivers a prompt into a session exactly once, at spawn. There is no
way to say "send this later," and no way to say "send this again."

A prompt you want to run on a rhythm (poll a build, re-check a branch, nudge a
long-running agent) has to be retyped every time. Work you want started fresh on
a cadence has no home at all, because the composer only launches now. And a
prompt you simply want delivered at a particular hour has nowhere to live but a
human's memory.

## Scope correction

This spec was first written around a fourth case: resuming a session wedged on a
usage limit, unattended, when the limit reset. That case is closed upstream and
is no longer a goal here.

Claude Code shipped it natively in **v2.1.236**, published 2026-08-19 (npm
publish time 18:45 UTC), with the changelog entry: "Claude Code now continues
your session automatically when a claude.ai usage limit resets." Confirmed by
observation, not just by the changelog: the maintainer watched a claude session
running inside a SeniorDev pty resume itself after a limit reset.

Two consequences carry into the design rather than merely being deleted:

- The feature is a **scheduler**, not an auto-resumer. The `once` trigger stays,
  because "run this at 15:00" is ordinary scheduling, but nothing here is built
  around a limit reset.
- A claude session that resumes **itself** is a live interaction, not a
  hypothetical. It is handled by the existing deferral gate rather than by any
  new machinery: a self-resuming session reports `working`, so a firing that
  comes due during it defers and keeps its slot instead of delivering a second
  prompt on top of the one claude just resumed. This is asserted by test rather
  than assumed.

Nothing upstream covers recurring delivery, and nothing upstream covers `codex`,
so the mechanism keeps its reason to exist in both directions.

## Use cases

1. **Recurring into an existing conversation.** The same prompt into the same
   conversation every N minutes, or daily at a wall-clock time.
2. **Recurring into a new session.** Folder, role, and prompt, launched fresh on
   a cadence, touching no existing session.
3. **A one-off at a chosen time.** A single prompt delivered at 15:00 to a
   conversation, whether or not its tab is still open.

## Non-goals

- **Auto-resume on a usage limit.** Closed upstream; see "Scope correction".
- **Cron expressions.** `once`, `every`, and `daily` cover every case above. A
  parser adds a dependency, a parse-error surface, and a UI that has to explain
  `0 5 * * *`. Add a fourth trigger variant when a real need appears.
- **Running while the app is closed.** Schedules live in the main process and
  fire only while SeniorDev runs. An OS-level trigger (launchd, Task Scheduler)
  is two platform integrations for a case the maintainer does not have: both
  machines stay awake with the app open.
- **Schedules in `config.yaml`.** A declarative block is attractive for standing
  recurring schedules, but wrong for the ad-hoc one-off, which is authored in the
  moment. Revisit once the recurring set proves stable enough to want in version
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
    | { kind: 'launch'; session: StartupSession; ticket?: string }
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
  deferredSinceAt: number | null   // when the current deferral began, so it can expire
  createdAt: number
}
```

The record lives in `src/shared/ipc.ts`, not in the store. The preload tsconfig
cannot reach `src/main`, which is the constraint that settles it, and it matches
the split the codebase already draws between `Conversation` and
`ConversationInfo`.

### Decisions inside the record

**A `conversation` target holds a `conversationId`, never a tab id.** Tab ids are
per-launch. A conversation survives the tab closing and the app restarting, which
a one-off at a chosen time requires: the tab may well be closed by then.

**A `launch` target holds a `StartupSession`** (`shared/ipc.ts`), the shape the
app already auto-starts a session from when a warm `seniordev --prompt ...`
arrives. Firing one is a push down machinery that exists rather than a second
parallel launch format, and it carries `mode: 'yolo'` natively.

**`daily` stores hour and minute, not an absolute timestamp.** `nextDueAt` is
recomputed from local date components on each firing, so 5am stays 5am across a
DST shift. Storing an interval would drift an hour twice a year, on exactly the
unattended runs nobody is watching closely enough to catch it.

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
would fire an overnight schedule whenever the window was next focused, which is
the one behaviour a scheduler cannot have. The main process has no such throttling.

**One ticker, wall-clock comparison, not one timer per schedule.** The runner
holds a single 15s interval and compares `nextDueAt` against `Date.now()`. Long
`setTimeout` values drift, and a wall-clock comparison handles a clock change, a
DST jump, and a window missed while the app was down through the same code path.

**Two of the three delivery paths need the renderer.** Injecting into a live tab
happens entirely in main, through prompt delivery
(`src/main/terminal/prompt-delivery.ts`, extracted from terminal-handlers so the
spawn path and the runner share one implementation and one cancel map). The
scheduled path calls `deliverNow`, which skips the readiness wait; see
"Delivery timing" below for why that is not optional. Launching new, and resuming a closed
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

**Everything lives in `SchedulesModal.vue`**, reached from Config, alongside
`AppConfigModal` and `PromptConfigModal`. One surface authors a schedule, shows
what it will do and when, and retires it. `RightPanel.vue` was considered and
rejected: the panel is per-session, and `launch` schedules belong to no session.

The list gives each schedule its title, what it points at, its trigger in words,
when it next runs, and what happened last time. A refused firing always carries
its reason rather than a bare status word, because "skipped" alone leaves the
reader guessing whether their session was typed into. Every state has a text
label, so nothing is signalled by colour alone. A recurring YOLO launch is named
as one, since it is the highest-consequence thing the list can hold.

The wording is a separate pure module (`renderer/src/schedule-format.ts`) and the
form's validation is another (`renderer/src/schedule-draft.ts`), so both are
tested directly; the component only arranges them. Validation is the only thing
between a typo and an unattended agent run: a sub-minute interval, a launch with
no folder (an agent CLI would sit on its trust-this-folder gate and swallow the
prompt), a time that is not a time.

### Model, for a scheduled launch

A scheduled launch may name its own model, so a routine job (checking mail,
polling a build) need not burn whatever the default happens to be. The field
appears only for "a new session": an existing conversation already has its model,
and a resume drops `modelArgs` by design (`terminal/session.ts`), so offering the
choice there would be a lie.

The app had no per-launch model override before this. Model was resolved purely
from config: prompt frontmatter, then the tool's `defaultModel`, then nothing.
`buildInteractiveLaunch` already accepted a model and turned it into argv through
each tool's `modelArgs`; nothing fed it except a prompt. A schedule now can, and
**its choice wins over the prompt's declared model**, being the more specific of
the two and authored deliberately for this run.

The control is a text input with a `<datalist>`, not a dropdown. Suggestions come
from a new optional `models: [...]` per tool in `config.yaml`, which is purely a
convenience list: nothing validates against it, so a model id newer than the
config stays usable the day it ships, and the field works before any config edit.
Blank omits the model entirely rather than sending an empty one, since blank
already means exactly the absent-model behaviour.

### Considered and not built

**A Schedule sibling to Launch in the Composer.** The original plan; dropped
because the modal's form already covers both target kinds, and a second authoring
surface would mean two paths to keep in step for no new capability.

**A tab context-menu item for scheduling into the session you are looking at.**
This was justified entirely by the ad-hoc "staring at a wedged session" case,
which is now a non-goal (see "Scope correction"). Worth revisiting only if
authoring from the modal proves too far from where the thought occurs.

**A tab context-menu item for scheduling into the session you are looking at.**
Justified entirely by the ad-hoc "staring at a wedged session" case, which is now
a non-goal (see "Scope correction"). Worth revisiting only if authoring from the
modal proves too far from where the thought occurs.

### The badge, which was a gap and is now built

A schedule that will type into a session unattended is visible **on** that
session, not only inside the modal, which is design principle 1 ("show the work,
always"). A sidebar conversation row carries a `scheduled` tag, and a live tab
carries a small clock.

One composable (`composables/useScheduleBadges.ts`) is created in `App` and
passed to both consumers the same way `ws` and `subagents` are, so the list is
fetched once rather than per consumer. It surfaces only **enabled** schedules: a
retired one means nothing is going to happen, and saying otherwise would be
noise.

Per the WCAG 2.1 AA target, neither is colour alone. The sidebar tag is the word
"scheduled" with the schedule's title and next run time on hover; the tab's clock
carries the same sentence as its `aria-label` and `title`, because the tab strip
has no room for the word inline.

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

## Delivery timing

The readiness wait that prompt delivery uses at spawn is **wrong for a scheduled
firing**, and this was measured rather than reasoned about. Driving a real
`node-pty` child, delivery into an established, already-idle session resolved
after **15,056ms, through the `MAX_WAIT_MS` safety valve**, never through the
quiet path. The cause is in `terminal/activity.ts`: `watch` only resolves on
output arriving *after* the watch begins, and a settled session emits none, so
the quiet path cannot succeed there.

The latency was the smaller half of the problem. The valve writes regardless of
state, so across those fifteen seconds a session could reach an approval prompt
and be typed into anyway, straight through the gate the runner had just applied.

So the scheduled path calls `deliverNow`, which writes immediately. This is
sound because the caller has already established receptiveness: `idle` from the
status hub means the rendered buffer settled *and* did not match the tool's
approval patterns, which is a stronger claim than byte-quiet. Re-measured after
the change: **1105ms end to end**, prompt received and submitted by a real child
process. A bracketed paste still waits before its Enter, which remains correct
because the paste is itself the output the watch needs.

`QUIET_MS` (700) and `SUBMIT_DELAY_MS` (300) are unchanged and the spawn path is
untouched; its twelve existing delivery tests pass against the extracted module
without modification.

## Risks

**Partly verified in the running app.** The maintainer ran it on 2026-08-21 and
watched a launch schedule spawn five agent sessions with a supplied model, so the
app boots with the runner going, a `launch` target fires, the per-launch model
reaches a real spawn, and tabs open. What that run did NOT exercise, and what is
still unverified by anything but unit and integration tests: injection into a
live idle conversation, the `needsYou` refusal, resuming a closed conversation,
and a missed slot resolving on restart.

A cosmetic regression did get through to that run and was found by eye rather
than by test: the schedule badge's style was inserted against a selector that
appears twice, which rewrote the dead-tab rule and left every tab greyed and
struck through. The class binding was correct throughout and no test reads the
stylesheet, so nothing but looking at the app could have caught it. Worth
remembering when weighing what a green suite here does and does not mean.

**A claude session now resumes itself.** Claude Code v2.1.236 continues a session
automatically when a claude.ai usage limit resets, and this was observed inside a
SeniorDev pty. A schedule that comes due during a self-resume therefore meets a
session that is `working`, and defers rather than delivering a second prompt on
top of it. That is the existing gate doing its job rather than new machinery, and
it is asserted by test. What is *not* covered is a tighter race: a firing and a
self-resume landing in the same instant, before the hub has reported `working`.
The window is one status update wide, the consequence is a duplicated prompt
rather than anything destructive, and it is not worth new machinery unless it is
seen in practice.
