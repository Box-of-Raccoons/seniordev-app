import type { WatchConfig } from '../main/config/schema'

// Escape backslash then double-quote so a label/status containing either can't
// break out of the JQL string literal.
function q(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function buildJql(watch: WatchConfig): string {
  return `assignee = currentUser() AND labels = ${q(watch.label)} AND statusCategory = ${q(watch.triggerStatusCategory)}`
}
