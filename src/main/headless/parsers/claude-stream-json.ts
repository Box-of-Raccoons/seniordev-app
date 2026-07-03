import { LineBuffer, type ParsedEvent, type StreamParser } from '../parser'

const MAX_ARG = 120

// Best-effort one-line summary of a tool call's most identifying input.
function toolArg(input: Record<string, unknown>): string {
  const v = input.file_path ?? input.path ?? input.command ?? input.pattern ?? input.url ?? ''
  return String(v).replace(/\s+/g, ' ').slice(0, MAX_ARG)
}

export class ClaudeStreamJsonParser implements StreamParser {
  private readonly lines = new LineBuffer()

  feed(chunk: string): ParsedEvent[] {
    return this.lines.push(chunk).flatMap((l) => this.line(l))
  }

  flush(): ParsedEvent[] {
    return this.lines.flush().flatMap((l) => this.line(l))
  }

  private line(l: string): ParsedEvent[] {
    if (!l.trim()) return []
    let ev: Record<string, unknown>
    try {
      ev = JSON.parse(l) as Record<string, unknown>
    } catch {
      return [{ kind: 'log', text: l }] // stdout noise — never lose it
    }
    if (ev.type === 'system' && ev.subtype === 'init' && typeof ev.session_id === 'string') {
      return [
        { kind: 'session', id: ev.session_id },
        { kind: 'log', text: `▸ session ${ev.session_id}` }
      ]
    }
    if (ev.type === 'assistant') {
      const msg = ev.message as { content?: unknown[] } | undefined
      const out: ParsedEvent[] = []
      for (const raw of msg?.content ?? []) {
        const b = raw as { type?: string; text?: string; name?: string; input?: Record<string, unknown> }
        if (b.type === 'text' && b.text) out.push({ kind: 'log', text: b.text })
        else if (b.type === 'tool_use' && b.name) {
          out.push({ kind: 'log', text: `▸ ${b.name} ${toolArg(b.input ?? {})}`.trimEnd() })
        }
      }
      return out
    }
    if (ev.type === 'result') {
      return [{ kind: 'log', text: ev.is_error ? '✘ run failed' : '✔ run finished' }]
    }
    // Known-but-uninteresting stream events (hooks, rate limits, user/tool results):
    // valid JSON that isn't one of the rendered types is skipped, not logged.
    return []
  }
}
