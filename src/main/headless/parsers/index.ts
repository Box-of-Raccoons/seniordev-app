import type { StreamParser } from '../parser'
import { ClaudeStreamJsonParser } from './claude-stream-json'
import { CodexJsonlParser } from './codex-jsonl'
import { TextParser } from './text'

export function createParser(
  name: 'claude-stream-json' | 'codex-jsonl' | 'text',
  sessionIdPattern?: string
): StreamParser {
  if (name === 'claude-stream-json') return new ClaudeStreamJsonParser()
  if (name === 'codex-jsonl') return new CodexJsonlParser()
  return new TextParser(sessionIdPattern)
}
