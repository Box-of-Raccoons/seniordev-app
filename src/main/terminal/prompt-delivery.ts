import type { SessionActivity } from './activity'

// Typing a prompt into a live agent TUI. Extracted from terminal-handlers so the
// spawn path and the schedule runner share ONE implementation: the timings below
// were tuned against real ink/ConPTY behaviour, and a second copy would drift
// away from them silently.
//
// Delivery must wait for the TUI to be READY, not for a fixed delay: claude takes
// ~2s to boot, ConPTY buffers anything written earlier and hands it to the TUI as
// ONE chunk, and ink then treats the bundled prompt+\r as a paste — the \r becomes
// pasted text instead of a submit (verified against claude 2.1.191: fixed 800ms
// delay → prompt stuck in composer; readiness detection → submitted and answered).
// Readiness = the session has produced output and then gone quiet for QUIET_MS.
export const QUIET_MS = 700
export const POLL_MS = 100
// Enter goes as its own keystroke a beat after the prompt text.
export const SUBMIT_DELAY_MS = 300
// Safety valve: if the CLI never settles (endless spinner), send anyway.
export const MAX_WAIT_MS = 15000

export interface PromptDelivery {
  /** Type `prompt` into session `id` once it is ready, then submit it. */
  deliver(id: string, prompt: string, bracketedPaste: boolean): void
  /**
   * Type `prompt` into a session ALREADY known to be receptive, with no
   * readiness wait. For the scheduled path, where the status hub has just
   * reported the tab `idle`.
   *
   * Waiting here is not merely redundant, it is wrong twice over. An established
   * idle session emits no output, and activity.watch only resolves on output
   * arriving AFTER the watch begins — so the quiet path never trips and every
   * delivery falls through the 15s safety valve (measured: 15,056ms against a
   * real pty). And that valve writes regardless of state, so during those 15
   * seconds the session can reach an approval prompt and receive the text
   * anyway, which is the one thing the schedule gate exists to prevent.
   *
   * `idle` from the hub is the stronger signal in any case: the rendered buffer
   * settled AND did not match the tool's approval patterns.
   */
  deliverNow(id: string, prompt: string, bracketedPaste: boolean): void
  /** Abandon a delivery in flight (the tab was killed or exited mid-delivery). */
  cancel(id: string): void
}

// One queued delivery. `awaitReady` is the only difference between the two entry
// points: `deliver` waits for the TUI to fall quiet before typing, `deliverNow`
// types straight away.
interface Job {
  prompt: string
  bracketedPaste: boolean
  awaitReady: boolean
}

// Per-session delivery state: the canceller for the step in flight (a pending
// quiet watch or the Enter timeout) plus the jobs waiting behind it. A lane
// exists only while a delivery is running for that id.
interface Lane {
  cancel: (() => void) | null
  queue: Job[]
}

export function createPromptDelivery(deps: {
  write: (id: string, data: string) => void
  activity: SessionActivity
}): PromptDelivery {
  // ONE prompt in flight per pty, ever. Two schedules can come due for the same
  // conversation on a single tick, and a spawn delivery can still be waiting for
  // quiet when a scheduled one arrives. Unserialized, their writes interleave
  // ("promptApromptB" then two bare \r), and the second delivery's canceller
  // replaces the first's, so a kill stops only the later one while the orphan
  // keeps writing into a dead pty.
  const lanes = new Map<string, Lane>()

  function cancel(id: string): void {
    const lane = lanes.get(id)
    if (!lane) return
    lane.cancel?.()
    // The queue goes with the running step: a killed pty must not receive the
    // prompts that were still waiting their turn behind the cancelled one.
    lanes.delete(id)
  }

  // Resolve `then` once the session has produced output and gone quiet for
  // quietMs (or the max-wait safety valve trips). Each call waits for NEW output
  // after it, which is what makes the two-step paste-then-submit below work.
  function waitForQuiet(id: string, lane: Lane, quietMs: number, then: () => void): void {
    const c = deps.activity.watch(id, { quietMs, maxWaitMs: MAX_WAIT_MS, pollMs: POLL_MS }, () => {
      // A cancel between arming and resolving retires the whole lane.
      if (lanes.get(id) !== lane) return
      lane.cancel = null
      then()
    })
    lane.cancel = c
  }

  // The write-then-submit half, shared by both entry points. The submit is a
  // separate keystroke either way; only whether we wait to BEGIN differs.
  function writeAndSubmit(id: string, lane: Lane, job: Job): void {
    // Bracketed paste (ESC[200~ … ESC[201~) tells a TUI that honors it (codex)
    // to take a multi-line prompt as ONE composer block, not submit per line.
    // Only for opted-in tools: the raw ESC would clear claude's composer.
    deps.write(id, job.bracketedPaste ? `\x1b[200~${job.prompt}\x1b[201~` : job.prompt)
    if (job.bracketedPaste) {
      // A large paste takes codex a beat to ingest; a fixed delay can beat it to
      // the composer and the Enter is dropped (the prompt lands but never runs).
      // Wait for the paste to render and the session to fall quiet again, THEN
      // submit — Enter as its own keystroke. This wait is sound even for an idle
      // session: the paste itself is the output the watch needs.
      waitForQuiet(id, lane, QUIET_MS, () => {
        deps.write(id, '\r')
        finish(id, lane)
      })
    } else {
      // claude's carefully-tuned path is unchanged: Enter a fixed beat later.
      const t = setTimeout(() => {
        if (lanes.get(id) !== lane) return
        lane.cancel = null
        deps.write(id, '\r')
        finish(id, lane)
      }, SUBMIT_DELAY_MS)
      lane.cancel = () => clearTimeout(t)
    }
  }

  function run(id: string, lane: Lane, job: Job): void {
    if (job.awaitReady) waitForQuiet(id, lane, QUIET_MS, () => writeAndSubmit(id, lane, job))
    else writeAndSubmit(id, lane, job)
  }

  // A delivery is complete the moment its \r is written; the next queued job
  // starts there, and an empty queue retires the lane so no canceller outlives
  // the delivery it belonged to.
  function finish(id: string, lane: Lane): void {
    if (lanes.get(id) !== lane) return
    lane.cancel = null
    const next = lane.queue.shift()
    if (!next) {
      lanes.delete(id)
      return
    }
    run(id, lane, next)
  }

  // A lane in the map always has a job running, so an existing one means queue.
  function enqueue(id: string, job: Job): void {
    const lane = lanes.get(id)
    if (lane) {
      lane.queue.push(job)
      return
    }
    const fresh: Lane = { cancel: null, queue: [] }
    lanes.set(id, fresh)
    run(id, fresh, job)
  }

  return {
    cancel,
    deliver(id, prompt, bracketedPaste) {
      enqueue(id, { prompt, bracketedPaste, awaitReady: true })
    },
    deliverNow(id, prompt, bracketedPaste) {
      enqueue(id, { prompt, bracketedPaste, awaitReady: false })
    }
  }
}
