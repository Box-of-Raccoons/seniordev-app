// S1 notifications (spec 5.5). A pure predicate for whether a status change
// warrants an OS notification, kept separate from the firing so the rules are
// unit-testable. The rules: only entering a state that wants your attention
// (needsYou / needsReview), only as a transition (never re-fire for the same
// state), and suppressed when you are already looking at that tab (it is the
// active tab AND the window has focus).

import type { TabStatus } from '../../shared/ipc'

export function shouldNotify(
  prev: TabStatus | undefined,
  next: TabStatus,
  isTabActive: boolean,
  isWindowFocused: boolean
): boolean {
  if (next !== 'needsYou' && next !== 'needsReview') return false
  if (prev === next) return false // no re-fire without an intervening transition
  if (isTabActive && isWindowFocused) return false // you are already looking at it
  return true
}

// The notification's heading + body for a notifiable state. Pure, so the copy is
// testable and the firing stays a thin wrapper.
export function notificationText(
  status: 'needsYou' | 'needsReview',
  tabTitle: string
): { heading: string; body: string } {
  const heading = status === 'needsYou' ? 'Needs your input' : 'Ready for review'
  return { heading, body: tabTitle }
}
