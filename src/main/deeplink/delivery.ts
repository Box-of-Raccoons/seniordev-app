import type { DeepLink } from '../../shared/ipc'

export interface DeliveryHooks {
  // Push a link to the live renderer (main only calls this when one is ready).
  send(link: DeepLink): void
  // Create the main window if none exists (no-op before app ready; the cold
  // start path drains the queue instead).
  ensureWindow(): void
}

// Warm deep-link delivery. A bare webContents.send is lossy twice over: during
// the window-created→renderer-mounted interval the listener isn't attached yet,
// and on macOS the app can be alive with zero windows (window-all-closed keeps
// running on darwin), so there is nothing to send to at all. Links are queued
// until the renderer signals readiness (DEEPLINK.ready), and a queued link
// summons a window when none exists.
export class DeepLinkDelivery {
  private queue: DeepLink[] = []
  private ready = false

  constructor(private readonly hooks: DeliveryHooks) {}

  deliver(link: DeepLink): void {
    if (this.ready) {
      this.hooks.send(link)
      return
    }
    this.queue.push(link)
    this.hooks.ensureWindow()
  }

  rendererReady(): void {
    this.ready = true
    for (const link of this.queue.splice(0)) this.hooks.send(link)
  }

  windowClosed(): void {
    this.ready = false
  }

  // Cold start consumes pre-window links via StartupOptions (pull) rather than
  // a push; whatever it takes here will not be re-sent on rendererReady.
  drainPending(): DeepLink[] {
    return this.queue.splice(0)
  }
}
