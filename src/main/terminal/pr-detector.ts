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

// Collect-all variant for headless YOLO: every distinct PR/MR URL, in first-seen
// order, across the whole run (a monorepo run can open several).
export class PrCollector {
  private buffer = ''
  private readonly seen = new Set<string>()
  private readonly ordered: string[] = []
  // matchAll needs the 'g' flag; compile once — feed() runs per log line.
  private readonly globals: { term: string; regex: RegExp }[]

  constructor(
    patterns: ForgePattern[],
    private readonly maxBuffer = 8192
  ) {
    this.globals = patterns.map((p) => ({
      term: p.term,
      regex: new RegExp(p.regex.source, p.regex.flags.includes('g') ? p.regex.flags : p.regex.flags + 'g')
    }))
  }

  feed(chunk: string): { url: string; term: string }[] {
    // A URL that straddles the eviction boundary at maxBuffer is silently
    // dropped — accepted sliding-window tradeoff (URLs are far shorter than 8k).
    this.buffer = (this.buffer + chunk).slice(-this.maxBuffer)
    const hits: { url: string; term: string }[] = []
    for (const p of this.globals) {
      for (const m of this.buffer.matchAll(p.regex)) {
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
