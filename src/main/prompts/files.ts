import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFrontmatter } from './library'
import { DEFAULT_ORCHESTRATOR_PROMPT } from '../config/presets'

export const CONTEXT_FILE = '_ticket-context.md'
// Underscore-prefixed so loadPrompts/library.ts excludes it: the orchestrator is
// routing machinery, not a listed playbook.
export const ORCHESTRATOR_FILE = '_jira-orchestrator.md'

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
  // Self-skip compares case-insensitively: Windows filesystems are, so
  // 'Fix-Bug.md' IS the file being written when name='fix-bug'.
  const self = `${name.toLowerCase()}.md`
  for (const f of existsSync(dir) ? readdirSync(dir) : []) {
    if (!f.toLowerCase().endsWith('.md') || f.startsWith('_') || f.toLowerCase() === self) continue
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

export function readOrchestratorFile(dir: string): string {
  const p = join(dir, ORCHESTRATOR_FILE)
  return existsSync(p) ? readFileSync(p, 'utf8') : DEFAULT_ORCHESTRATOR_PROMPT
}

export function writeOrchestratorFile(dir: string, text: string): void {
  const p = join(dir, ORCHESTRATOR_FILE)
  // Saving the built-in text verbatim reverts to the preset (delete the override)
  // — mirrors saveRecap's delete-when-default semantics in config-handlers.ts.
  if (text.trim() === DEFAULT_ORCHESTRATOR_PROMPT.trim()) {
    if (existsSync(p)) unlinkSync(p)
    return
  }
  writeAtomic(p, text)
}
