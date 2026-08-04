import type { DeepLink } from '../../shared/ipc'

export interface WarmHooks<T> {
  // Push an item to the live renderer (main only calls this when one is ready).
  send(item: T): void
  // Create the main window if none exists (no-op before app ready; the cold
  // start path drains the queue instead).
  ensureWindow(): void
}

// Warm push delivery. A bare webContents.send is lossy twice over: during the
// window-created→renderer-mounted interval the listener isn't attached yet, and
// on macOS the app can be alive with zero windows (window-all-closed keeps
// running on darwin), so there is nothing to send to at all. Items are queued
// until the renderer signals readiness (DEEPLINK.ready), and a queued item
// summons a window when none exists. Used for deep links and warm CLI sessions.
export class WarmDelivery<T> {
  private queue: T[] = []
  private ready = false

  constructor(private readonly hooks: WarmHooks<T>) {}

  deliver(item: T): void {
    if (this.ready) {
      this.hooks.send(item)
      return
    }
    this.queue.push(item)
    this.hooks.ensureWindow()
  }

  rendererReady(): void {
    this.ready = true
    for (const item of this.queue.splice(0)) this.hooks.send(item)
  }

  windowClosed(): void {
    this.ready = false
  }

  // Cold start consumes pre-window items via StartupOptions (pull) rather than a
  // push; whatever it takes here will not be re-sent on rendererReady.
  drainPending(): T[] {
    return this.queue.splice(0)
  }
}

// Back-compat: deep-link delivery is the original WarmDelivery consumer. Keeping
// the named subclass leaves its call sites and tests untouched.
export type DeliveryHooks = WarmHooks<DeepLink>
export class DeepLinkDelivery extends WarmDelivery<DeepLink> {}
