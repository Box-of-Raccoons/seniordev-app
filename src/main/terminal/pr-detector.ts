import type { Config } from '../config/schema'

export interface ForgePattern {
  term: string
  regex: RegExp
}

export function buildForgePatterns(config: Config): ForgePattern[] {
  const out: ForgePattern[] = []
  for (const forge of Object.values(config.forges ?? {})) {
    try {
      out.push({ term: forge.term, regex: new RegExp(forge.urlPattern) })
    } catch {
      // skip an invalid pattern rather than crashing the session
    }
  }
  return out
}

export class PrDetector {
  private buffer = ''
  private found = false

  constructor(
    private readonly patterns: ForgePattern[],
    private readonly maxBuffer = 8192
  ) {}

  feed(chunk: string): { url: string; term: string } | null {
    if (this.found) return null
    this.buffer = (this.buffer + chunk).slice(-this.maxBuffer)
    for (const p of this.patterns) {
      const m = this.buffer.match(p.regex)
      if (m) {
        this.found = true
        return { url: m[0], term: p.term }
      }
    }
    return null
  }
}

// Collect-all variant for headless YOLO: every distinct PR/MR URL, in first-seen
// order, across the whole run (a monorepo run can open several).
export class PrCollector {
  private buffer = ''
  private readonly seen = new Set<string>()
  private readonly ordered: string[] = []

  constructor(
    private readonly patterns: ForgePattern[],
    private readonly maxBuffer = 8192
  ) {}

  feed(chunk: string): { url: string; term: string }[] {
    this.buffer = (this.buffer + chunk).slice(-this.maxBuffer)
    const hits: { url: string; term: string }[] = []
    for (const p of this.patterns) {
      const global = new RegExp(p.regex.source, p.regex.flags.includes('g') ? p.regex.flags : p.regex.flags + 'g')
      for (const m of this.buffer.matchAll(global)) {
        if (!this.seen.has(m[0])) {
          this.seen.add(m[0])
          this.ordered.push(m[0])
          hits.push({ url: m[0], term: p.term })
        }
      }
    }
    return hits
  }

  get urls(): string[] {
    return [...this.ordered]
  }
}
