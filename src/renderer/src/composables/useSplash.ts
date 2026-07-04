import { getCurrentScope, onScopeDispose, ref } from 'vue'

export interface SplashOptions {
  /**
   * Minimum time (ms) the splash stays up once shown, so a fast boot doesn't
   * flash the branding for a few frames and vanish.
   */
  minVisibleMs?: number
  /**
   * Safety cap (ms): dismiss even if `ready()` never fires — a hung startup must
   * not pin the splash on screen forever.
   */
  maxVisibleMs?: number
  /** Injectable clock — `Date.now` in the app, controllable from tests. */
  now?: () => number
}

export const SPLASH_DEFAULTS = { minVisibleMs: 3000, maxVisibleMs: 8000 } as const

/**
 * Drives the boot splash lifecycle. The splash starts visible (it is part of the
 * renderer's first meaningful paint) and stays up until the app signals it is
 * ready — but never for less than `minVisibleMs` (no flash-and-vanish) nor more
 * than `maxVisibleMs` (no getting stuck behind a hung startup). Timing lives here
 * so it can be unit-tested without mounting a window.
 */
export function useSplash(opts: SplashOptions = {}) {
  const minVisibleMs = opts.minVisibleMs ?? SPLASH_DEFAULTS.minVisibleMs
  const maxVisibleMs = opts.maxVisibleMs ?? SPLASH_DEFAULTS.maxVisibleMs
  const now = opts.now ?? (() => Date.now())

  const visible = ref(true)
  const start = now()
  let minTimer: ReturnType<typeof setTimeout> | null = null
  let maxTimer: ReturnType<typeof setTimeout> | null = null

  function clearTimers(): void {
    if (minTimer != null) { clearTimeout(minTimer); minTimer = null }
    if (maxTimer != null) { clearTimeout(maxTimer); maxTimer = null }
  }

  function hide(): void {
    visible.value = false
    clearTimers()
  }

  // Safety net first: even if `ready()` is never called, the splash comes down.
  maxTimer = setTimeout(hide, maxVisibleMs)

  /**
   * Signal that startup work has settled. Dismisses immediately if the splash
   * has already had its minimum on-screen time, otherwise waits out the
   * remainder so branding is always shown for at least `minVisibleMs`.
   */
  function ready(): void {
    if (!visible.value) return
    const remaining = minVisibleMs - (now() - start)
    if (remaining <= 0) hide()
    else if (minTimer == null) minTimer = setTimeout(hide, remaining)
  }

  // Only register cleanup inside an active effect scope (component setup); a
  // standalone call in a unit test has no scope and tears its own timers down.
  if (getCurrentScope()) onScopeDispose(clearTimers)

  return { visible, ready, hide }
}
