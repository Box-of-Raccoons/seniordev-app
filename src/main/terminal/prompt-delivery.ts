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

export function createPromptDelivery(deps: {
  write: (id: string, data: string) => void
  activity: SessionActivity
}): PromptDelivery {
  // Canceller for the delivery step currently in flight (a pending quiet watch or
  // the Enter timeout), so a kill/exit can stop it mid-delivery.
  const cancels = new Map<string, () => void>()

  function cancel(id: string): void {
    cancels.get(id)?.()
    cancels.delete(id)
  }

  // Resolve `then` once the session has produced output and gone quiet for
  // quietMs (or the max-wait safety valve trips). Each call waits for NEW output
  // after it, which is what makes the two-step paste-then-submit below work.
  function waitForQuiet(id: string, quietMs: number, then: () => void): void {
    const c = deps.activity.watch(id, { quietMs, maxWaitMs: MAX_WAIT_MS, pollMs: POLL_MS }, () => {
      cancels.delete(id)
      then()
    })
    cancels.set(id, c)
  }

  // The write-then-submit half, shared by both entry points. The submit is a
  // separate keystroke either way; only whether we wait to BEGIN differs.
  function writeAndSubmit(id: string, prompt: string, bracketedPaste: boolean): void {
    // Bracketed paste (ESC[200~ … ESC[201~) tells a TUI that honors it (codex)
    // to take a multi-line prompt as ONE composer block, not submit per line.
    // Only for opted-in tools: the raw ESC would clear claude's composer.
    deps.write(id, bracketedPaste ? `\x1b[200~${prompt}\x1b[201~` : prompt)
    if (bracketedPaste) {
      // A large paste takes codex a beat to ingest; a fixed delay can beat it to
      // the composer and the Enter is dropped (the prompt lands but never runs).
      // Wait for the paste to render and the session to fall quiet again, THEN
      // submit — Enter as its own keystroke. This wait is sound even for an idle
      // session: the paste itself is the output the watch needs.
      waitForQuiet(id, QUIET_MS, () => deps.write(id, '\r'))
    } else {
      // claude's carefully-tuned path is unchanged: Enter a fixed beat later.
      const t = setTimeout(() => {
        deps.write(id, '\r')
        cancels.delete(id)
      }, SUBMIT_DELAY_MS)
      cancels.set(id, () => clearTimeout(t))
    }
  }

  return {
    cancel,
    deliver(id, prompt, bracketedPaste) {
      waitForQuiet(id, QUIET_MS, () => writeAndSubmit(id, prompt, bracketedPaste))
    },
    deliverNow(id, prompt, bracketedPaste) {
      writeAndSubmit(id, prompt, bracketedPaste)
    }
  }
}
