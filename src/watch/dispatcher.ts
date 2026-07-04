import type { Config } from '../main/config/schema'
import type { Ticket } from '../shared/types'
import { buildJql } from './jql'
import { findRepoForTicket } from './repo-map'
import { SequentialQueue } from './queue'
import type { WatchState } from './state'

export interface WatchNotification {
  title: string
  body: string
  ticketKey?: string
  onClick?: () => void
}

export interface DispatcherDeps {
  config: () => Config
  search: (jql: string) => Promise<Ticket[]>
  transition: (key: string, name: string) => Promise<void>
  // Launch the SeniorDev app to run the Jira Orchestrator on this ticket in a
  // visible, watchable tab. The app owns the run ("no invisible work") and
  // resolves the repo cwd from the same config.repos. Resolves once the child
  // has spawned; REJECTS if it fails to spawn (ENOENT/EPERM/AV) so the dispatcher
  // can avoid recording a run that never started (SD-9 B1).
  launch: (ticket: Ticket) => void | Promise<void>
  state: WatchState
  notify: (n: WatchNotification) => void
  isAuto: () => boolean
  now: () => string
  // Called when the pending-approval set changes outside a poll (e.g. an approval
  // from a notification click) so the tray menu can refresh (SD-9 low #2).
  onChange?: () => void
}

// Poll → filter (deduped by state + in-flight + pending) → enqueue (auto) or hold
// for approval → launch the app. On launch the ticket is recorded + transitioned
// so it leaves the query and is never re-dispatched.
export class WatchDispatcher {
  private readonly queue = new SequentialQueue()
  private readonly inFlight = new Set<string>()
  private readonly pending = new Map<string, Ticket>()
  private polling = false

  constructor(private readonly deps: DispatcherDeps) {}

  get pendingCount(): number {
    return this.pending.size
  }

  get inFlightCount(): number {
    return this.inFlight.size
  }

  // Tickets awaiting manual approval (approve-first mode), for the tray submenu —
  // so a missed notification isn't the only way to approve.
  pendingApprovals(): { key: string; summary: string }[] {
    return [...this.pending.values()].map((t) => ({ key: t.key, summary: t.summary }))
  }

  async poll(): Promise<void> {
    if (this.polling) return // suppress overlapping ticks
    this.polling = true
    try {
      const cfg = this.deps.config()
      let tickets: Ticket[]
      try {
        tickets = await this.deps.search(buildJql(cfg.watch))
      } catch (err) {
        this.deps.notify({ title: 'Jira poll failed', body: this.msg(err) })
        return
      }
      // Prune approvals for tickets that no longer match the query — they were
      // handled, reassigned, or moved out of the trigger status elsewhere, so a
      // stale "Approve X?" entry would dispatch something no longer wanted
      // (SD-9 low #3). runPoll refreshes the tray right after this poll.
      const present = new Set(tickets.map((t) => t.key))
      for (const key of [...this.pending.keys()]) {
        if (!present.has(key)) this.pending.delete(key)
      }
      for (const t of tickets) {
        const key = t.key
        if (this.deps.state.has(key) || this.inFlight.has(key) || this.pending.has(key)) continue
        const repo = findRepoForTicket(cfg, key)
        if (!repo) {
          this.deps.notify({ title: `${key}: no repo configured`, body: t.summary, ticketKey: key })
          continue
        }
        if (this.deps.isAuto()) {
          this.enqueue(t)
        } else {
          this.pending.set(key, t)
          this.deps.notify({ title: `Approve ${key}?`, body: t.summary, ticketKey: key, onClick: () => this.approve(key) })
        }
      }
    } finally {
      this.polling = false
    }
  }

  approve(key: string): void {
    const ticket = this.pending.get(key)
    if (!ticket) return
    this.pending.delete(key)
    this.enqueue(ticket)
    // A notification-click approval happens outside a poll; nudge the tray so its
    // pending count/submenu don't go stale (SD-9 low #2).
    this.deps.onChange?.()
  }

  private enqueue(ticket: Ticket): void {
    // Reserve the key synchronously so a poll while this ticket waits in the queue
    // can't re-dispatch it (it isn't recorded until dispatch runs).
    this.inFlight.add(ticket.key)
    this.queue.enqueue(() => this.dispatch(ticket))
  }

  private async dispatch(ticket: Ticket): Promise<void> {
    const key = ticket.key
    try {
      // Defense-in-depth: never dispatch a ticket already recorded.
      if (this.deps.state.has(key)) return
      // Launch and wait for the child to actually spawn before committing. If it
      // fails to spawn, nothing is recorded or transitioned, so the ticket stays
      // in the query and the next poll re-dispatches it — no stranded ticket, no
      // uncaught 'error' crashing the tray (SD-9 B1).
      try {
        await this.deps.launch(ticket)
      } catch (err) {
        this.deps.notify({ title: `Launch failed: ${key}`, body: this.msg(err), ticketKey: key })
        return
      }
      this.deps.state.record(key, 'spawned', this.deps.now())
      try {
        await this.deps.transition(key, this.deps.config().watch.transitionOnDispatch)
      } catch (err) {
        this.deps.notify({ title: `Transition failed: ${key}`, body: this.msg(err), ticketKey: key })
      }
      this.deps.notify({ title: `Dispatched ${key} → SeniorDev`, body: ticket.summary, ticketKey: key })
    } catch (err) {
      this.deps.notify({ title: `Dispatch error: ${key}`, body: this.msg(err), ticketKey: key })
    } finally {
      this.inFlight.delete(key)
    }
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }
}
