// One job at a time, FIFO. A throwing job is swallowed so the queue keeps
// draining — the dispatcher already reports per-ticket failures via notify.
export class SequentialQueue {
  private jobs: Array<() => Promise<void>> = []
  private running = false

  get size(): number {
    return this.jobs.length
  }

  get active(): boolean {
    return this.running
  }

  enqueue(job: () => Promise<void>): void {
    this.jobs.push(job)
    void this.drain()
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.jobs.length) {
        const job = this.jobs.shift()!
        await job().catch(() => {})
      }
    } finally {
      this.running = false
    }
  }
}
