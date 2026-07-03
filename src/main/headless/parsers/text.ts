import { LineBuffer, type ParsedEvent, type StreamParser } from '../parser'

export class TextParser implements StreamParser {
  private readonly lines = new LineBuffer()
  private readonly sessionRegex: RegExp | null
  private sessionFound = false

  constructor(sessionIdPattern?: string) {
    let re: RegExp | null = null
    if (sessionIdPattern) {
      try {
        re = new RegExp(sessionIdPattern)
      } catch {
        // invalid user pattern — log passthrough still works, resume just won't
      }
    }
    this.sessionRegex = re
  }

  feed(chunk: string): ParsedEvent[] {
    return this.lines.push(chunk).flatMap((l) => this.line(l))
  }

  flush(): ParsedEvent[] {
    return this.lines.flush().flatMap((l) => this.line(l))
  }

  private line(l: string): ParsedEvent[] {
    const out: ParsedEvent[] = [{ kind: 'log', text: l }]
    if (!this.sessionFound && this.sessionRegex) {
      const m = l.match(this.sessionRegex)
      if (m) {
        this.sessionFound = true
        out.push({ kind: 'session', id: m[1] ?? m[0] })
      }
    }
    return out
  }
}
