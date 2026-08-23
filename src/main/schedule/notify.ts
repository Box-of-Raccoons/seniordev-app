import { Notification } from 'electron'

// Details a schedule notice needs to render: a firing that refused or failed,
// surfaced to the user (see RunnerDeps.notify in schedule/runner.ts). A
// routine success never reaches here.
export interface ScheduleNoticeInput {
  title: string
  outcome: string
  reason: string
}

// The piece that actually talks to Electron, injected so this is testable
// without a real Notification.
export type NotificationFactory = (opts: { title: string; body: string }) => void

// Electron's own Notification, guarded by isSupported() (false on a headless
// box or a platform with no notification service) so a boot-time firing never
// throws.
const defaultFactory: NotificationFactory = (opts) => {
  if (!Notification.isSupported()) return
  new Notification(opts).show()
}

// Runs from the main process, not the renderer: a startup-miss notice fires on
// the runner's first tick, before any window (and therefore any renderer
// listener) exists, so a renderer-side Notification is dropped 100% of the
// time it matters. See index.ts's notify callback.
export function showScheduleNotice(input: ScheduleNoticeInput, notify: NotificationFactory = defaultFactory): void {
  notify({ title: `Schedule ${input.outcome}: ${input.title}`, body: input.reason })
}
