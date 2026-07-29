// Continuous per-session output-activity tracker. Fed from the pty `onData`
// callback, it holds each session's last-output timestamp for the whole life of
// the session (removed only on exit), and lets any number of consumers register
// a `watch` that resolves when output has arrived *since the watch began* and
// then fallen quiet.
//
// One source of truth for "quiet". The prompt-delivery path (one-shot, tuned
// against real ink/ConPTY timing) and the status monitor (continuous) both read
// the same activity rather than each running their own interval timer over the
// same session and disagreeing — the failure mode being designed out. See the
// S1 plan section 1.1 for why the old `waitForQuiet`, which reset activity on
// every call, could not simply be shared.

const POLL_MS = 100

export interface WatchOptions {
  /** Resolve once output has been quiet this long after arriving. */
  quietMs: number
  /** Safety valve: resolve after this budget elapses even if never settled. */
  maxWaitMs?: number
  /** Poll cadence; defaults to POLL_MS. */
  pollMs?: number
}

export interface SessionActivity {
  /** Record an output event for a session. Call from `onData`, every time. */
  data(id: string): void
  /** Forget a session's activity. Call from `onExit` / kill. */
  clear(id: string): void
  /**
   * Resolve `onQuiet` once this session has produced output *at or after this
   * call* and then gone quiet for `quietMs`, or once `maxWaitMs` elapses (if
   * given). One-shot: it fires at most once and then stops itself. Returns a
   * canceller that prevents a not-yet-fired resolution.
   *
   * A continuous consumer (the status monitor) re-arms by registering a fresh
   * watch after each resolution; because a new watch captures a new start mark,
   * it only fires on output that arrives after it, never on stale activity.
   */
  watch(id: string, opts: WatchOptions, onQuiet: () => void): () => void
}

export function createSessionActivity(): SessionActivity {
  // Timestamp of the most recent output event per session. Absent means no
  // output has been seen since the session was (re)created — deliberately not a
  // `0` sentinel, because a faked clock can legitimately read 0.
  const lastData = new Map<string, number>()

  return {
    data(id) {
      lastData.set(id, Date.now())
    },

    clear(id) {
      lastData.delete(id)
    },

    watch(id, opts, onQuiet) {
      const startMark = Date.now()
      const pollMs = opts.pollMs ?? POLL_MS
      let iv: NodeJS.Timeout | undefined = setInterval(() => {
        const last = lastData.get(id)
        const now = Date.now()
        // "Output arrived after this watch began" — data recorded at or after
        // the start mark. Anything older is excluded, exactly as the old reset
        // to `sawData: false` excluded output from before the call.
        const sawDataAfterMark = last !== undefined && last >= startMark
        const settled = sawDataAfterMark && now - last >= opts.quietMs
        const maxTripped = opts.maxWaitMs !== undefined && now - startMark >= opts.maxWaitMs
        if (!settled && !maxTripped) return
        stop()
        onQuiet()
      }, pollMs)
      function stop(): void {
        if (iv) {
          clearInterval(iv)
          iv = undefined
        }
      }
      return stop
    }
  }
}
