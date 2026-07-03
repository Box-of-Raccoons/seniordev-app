import type { Config } from '../main/config/schema'
import type { Ticket } from '../shared/types'
import type { ClassifyResult } from '../shared/ipc'
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
  classify: (ticket: Ticket, repoPath: string) => Promise<ClassifyResult>
  spawn: (ticket: Ticket, repoPath: string, promptName: string) => Promise<{ exitCode: number; prUrls: string[] }>
  state: WatchState
  notify: (n: WatchNotification) => void
  isAuto: () => boolean
  now: () => string
}

// Poll → filter (deduped by state + in-flight + pending) → enqueue (auto) or hold
// for approval → sequential classify→spawn. Transition + record happen once the
// stage-2 run is committed, so the ticket leaves the query and is never
// re-dispatched. A classify failure records 'failed' (no transition) so a
// non-routable ticket doesn't storm the classifier every tick.
export class WatchDispatcher {
  private readonly queue = new SequentialQueue()
  private readonly inFlight = new Set<string>()
  private readonly pending = new Map<string, { ticket: Ticket; repoPath: string }>()
  private polling = false

  constructor(private readonly deps: DispatcherDeps) {}

  get pendingCount(): number {
    return this.pending.size
  }

  get inFlightCount(): number {
    return this.inFlight.size
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
      for (const t of tickets) {
        const key = t.key
        if (this.deps.state.has(key) || this.inFlight.has(key) || this.pending.has(key)) continue
        const repo = findRepoForTicket(cfg, key)
        if (!repo) {
          this.deps.notify({ title: `${key}: no repo configured`, body: t.summary, ticketKey: key })
          continue
        }
        if (this.deps.isAuto()) {
          this.enqueue(t, repo.path)
        } else {
          this.pending.set(key, { ticket: t, repoPath: repo.path })
          this.deps.notify({ title: `Approve ${key}?`, body: t.summary, ticketKey: key, onClick: () => this.approve(key) })
        }
      }
    } finally {
      this.polling = false
    }
  }

  approve(key: string): void {
    const held = this.pending.get(key)
    if (!held) return
    this.pending.delete(key)
    this.enqueue(held.ticket, held.repoPath)
  }

  private enqueue(ticket: Ticket, repoPath: string): void {
    this.queue.enqueue(() => this.dispatch(ticket, repoPath))
  }

  private async dispatch(ticket: Ticket, repoPath: string): Promise<void> {
    const key = ticket.key
    this.inFlight.add(key)
    try {
      const verdict = await this.deps.classify(ticket, repoPath)
      if (!verdict.ok) {
        this.deps.state.record(key, 'failed', this.deps.now())
        this.deps.notify({ title: `Routing failed: ${key}`, body: verdict.reason, ticketKey: key })
        return
      }
      // Commit the run: record + leave the query BEFORE the long stage-2 run so a
      // re-poll can't re-dispatch it.
      this.deps.state.record(key, 'spawned', this.deps.now())
      try {
        await this.deps.transition(key, this.deps.config().watch.transitionOnDispatch)
      } catch (err) {
        this.deps.notify({ title: `Transition failed: ${key}`, body: this.msg(err), ticketKey: key })
      }
      this.deps.notify({ title: `Running ${verdict.prompt} on ${key}`, body: ticket.summary, ticketKey: key })
      const res = await this.deps.spawn(ticket, repoPath, verdict.prompt)
      const body = res.prUrls.length
        ? res.prUrls.join(', ')
        : res.exitCode === 0 ? 'no PR detected' : `run exited ${res.exitCode}`
      this.deps.notify({ title: `Done: ${key} (${verdict.prompt})`, body, ticketKey: key })
    } finally {
      this.inFlight.delete(key)
    }
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }
}
