import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFrontmatter } from './library'

export const CONTEXT_FILE = '_ticket-context.md'

// What {{ticket.context}} expands to until the user edits it — reproduces the
// de-facto layout the shipped example prompts used.
export const DEFAULT_TICKET_CONTEXT = `Work Jira ticket {{ticket.key}}: "{{ticket.summary}}"

{{ticket.description}}

Acceptance criteria:
{{ticket.acceptanceCriteria}}`

// Filename-safe, no leading underscore (reserved for specials) or dot.
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function assertName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new Error(`Invalid prompt name: "${name}" (letters/digits/._- only; must not start with _ or .)`)
  }
}

function fileOf(dir: string, name: string): string {
  return join(dir, `${name}.md`)
}

function writeAtomic(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, path)
}

export function readPromptFile(dir: string, name: string): string {
  assertName(name)
  return readFileSync(fileOf(dir, name), 'utf8')
}

export function writePromptFile(dir: string, name: string, text: string): void {
  assertName(name)
  const effective = parseFrontmatter(text, name).name
  // The effective name (frontmatter name ?? filename) must not collide with
  // any OTHER file's effective name — findPrompt() resolves by that name.
  for (const f of readdirSync(dir)) {
    if (!f.toLowerCase().endsWith('.md') || f.startsWith('_') || f === `${name}.md`) continue
    const other = parseFrontmatter(readFileSync(join(dir, f), 'utf8'), f.replace(/\.md$/i, ''))
    if (other.name === effective) throw new Error(`Prompt name "${effective}" collides with ${f}`)
  }
  writeAtomic(fileOf(dir, name), text)
}

export function createPromptFile(dir: string, name: string): string {
  assertName(name)
  if (existsSync(fileOf(dir, name))) throw new Error(`Prompt "${name}" already exists`)
  const skeleton = `---
name: ${name}
description:
---

Work Jira ticket {{ticket.key}}.

{{ticket.context}}
`
  writeAtomic(fileOf(dir, name), skeleton)
  return skeleton
}

export function deletePromptFile(dir: string, name: string): void {
  assertName(name)
  unlinkSync(fileOf(dir, name))
}

export function readContextFile(dir: string): string {
  const p = join(dir, CONTEXT_FILE)
  return existsSync(p) ? readFileSync(p, 'utf8') : DEFAULT_TICKET_CONTEXT
}

export function writeContextFile(dir: string, text: string): void {
  writeAtomic(join(dir, CONTEXT_FILE), text)
}
