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

  return {
    cancel,
    deliver(id, prompt, bracketedPaste) {
      waitForQuiet(id, QUIET_MS, () => {
        // Bracketed paste (ESC[200~ … ESC[201~) tells a TUI that honors it (codex)
        // to take a multi-line prompt as ONE composer block, not submit per line.
        // Only for opted-in tools: the raw ESC would clear claude's composer.
        deps.write(id, bracketedPaste ? `\x1b[200~${prompt}\x1b[201~` : prompt)
        if (bracketedPaste) {
          // A large paste takes codex a beat to ingest; a fixed delay can beat it
          // to the composer and the Enter is dropped (the prompt lands but never
          // runs). Wait for the paste to render and the session to fall quiet
          // again, THEN submit — Enter as its own keystroke.
          waitForQuiet(id, QUIET_MS, () => deps.write(id, '\r'))
        } else {
          // claude's carefully-tuned path is unchanged: Enter a fixed beat later.
          const t = setTimeout(() => {
            deps.write(id, '\r')
            cancels.delete(id)
          }, SUBMIT_DELAY_MS)
          cancels.set(id, () => clearTimeout(t))
        }
      })
    }
  }
}
