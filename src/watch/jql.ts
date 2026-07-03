import type { WatchConfig } from '../main/config/schema'

// Escape a double-quote so a label/status containing one can't break out of the
// JQL string literal.
function q(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`
}

export function buildJql(watch: WatchConfig): string {
  return `assignee = currentUser() AND labels = ${q(watch.label)} AND statusCategory = ${q(watch.triggerStatusCategory)}`
}
