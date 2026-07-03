export type ParsedEvent = { kind: 'log'; text: string } | { kind: 'session'; id: string }

export interface StreamParser {
  feed(chunk: string): ParsedEvent[]
  flush(): ParsedEvent[]
}

// Accumulates stream chunks and yields only complete lines; the partial tail
// waits for the next chunk (or flush() at process exit).
export class LineBuffer {
  private buf = ''

  push(chunk: string): string[] {
    this.buf += chunk
    const lines = this.buf.split(/\r?\n/)
    this.buf = lines.pop() ?? ''
    return lines
  }

  flush(): string[] {
    const rest = this.buf
    this.buf = ''
    return rest ? [rest] : []
  }
}
