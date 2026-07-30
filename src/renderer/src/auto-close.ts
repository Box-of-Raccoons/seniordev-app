import type { TabKind } from './composables/usePanes'

// D3 / spec section 7.2: a cleanly-exited agent (terminal) OR shell tab closes
// automatically. An agent tab's conversation survives in storage and stays
// resumable; a shell has nothing to resume but a clean `exit` leaves nothing to
// look at either — Hardy's call (2026-07-30) is to close both. A YOLO tab stays
// (its exit-0 is needsReview, the walked-away-from case), and any non-zero exit
// stays as failed so the failure is visible. A composer tab has no pty to exit.
export function shouldAutoClose(kind: TabKind, exitCode: number): boolean {
  return exitCode === 0 && (kind === 'terminal' || kind === 'shell')
}
