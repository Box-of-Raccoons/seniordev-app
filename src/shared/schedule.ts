import type { ScheduleTrigger } from './ipc'

// Schedule rules both sides of the bridge have to agree on. The renderer's form
// and the main-side store each used to carry their own idea of what a cap is,
// which meant the cap a bad value got depended on which layer caught it first.

// A recurring schedule with no cap is not a valid record, so the migrate and
// create paths force one rather than rejecting the schedule outright: degrading
// to a bounded schedule is the safe direction, refusing to load one is not.
// Roughly two days of a half-hourly schedule: long enough to be useful, short
// enough that an abandoned schedule stops on its own.
export const DEFAULT_MAX_FIRINGS = 100

// The last line of defence for a stored cap, applied to records arriving from
// disk or over the bridge. The form validates and refuses; this repairs, because
// a record already on disk has to load as something.
export function normaliseMaxFirings(trigger: ScheduleTrigger, raw: unknown): number | null {
  if (trigger.kind === 'once') return typeof raw === 'number' ? raw : null
  return typeof raw === 'number' && raw > 0 ? raw : DEFAULT_MAX_FIRINGS
}
