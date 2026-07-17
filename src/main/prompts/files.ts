import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFrontmatter } from './library'

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

Your task:

{{request}}
`
  writeAtomic(fileOf(dir, name), skeleton)
  return skeleton
}

export function deletePromptFile(dir: string, name: string): void {
  assertName(name)
  unlinkSync(fileOf(dir, name))
}
