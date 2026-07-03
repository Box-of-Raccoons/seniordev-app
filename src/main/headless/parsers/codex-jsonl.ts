import { LineBuffer, type ParsedEvent, type StreamParser } from '../parser'

export class CodexJsonlParser implements StreamParser {
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
      return [{ kind: 'log', text: l }]
    }
    // JSON.parse also accepts primitives and arrays ('null', '[1]', '"x"') —
    // not events; treat them as noise too instead of throwing on .type access.
    if (typeof ev !== 'object' || ev === null || Array.isArray(ev)) {
      return [{ kind: 'log', text: l }]
    }
    const item = ev.item as { type?: string; command?: string; text?: string } | undefined
    switch (ev.type) {
      case 'thread.started':
        return typeof ev.thread_id === 'string'
          ? [
              { kind: 'session', id: ev.thread_id },
              { kind: 'log', text: `▸ thread ${ev.thread_id}` }
            ]
          : []
      case 'item.started':
        return item?.type === 'command_execution' && item.command
          ? [{ kind: 'log', text: `▸ run ${item.command}` }]
          : []
      case 'item.completed':
        return item?.type === 'agent_message' && item.text ? [{ kind: 'log', text: item.text }] : []
      case 'turn.failed': {
        const msg = (ev.error as { message?: string } | undefined)?.message
        return [{ kind: 'log', text: `✘ turn failed${msg ? `: ${msg}` : ''}` }]
      }
      case 'error':
        return [{ kind: 'log', text: `✘ ${typeof ev.message === 'string' ? ev.message : 'error'}` }]
      default:
        return [] // turn.started / turn.completed / future event types
    }
  }
}
