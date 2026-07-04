import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'

export interface PromptTemplate {
  name: string
  description: string
  // Optional model this prompt should run on (SD-5). Absent ⇒ fall back to the
  // tool's defaultModel, then to nothing. Only set when present in frontmatter.
  model?: string
  body: string
}

export function parseFrontmatter(raw: string, fallbackName: string): PromptTemplate {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { name: fallbackName, description: '', body: raw.trim() }
  const fm = (parse(m[1]) ?? {}) as Record<string, unknown>
  return {
    name: typeof fm.name === 'string' ? fm.name : fallbackName,
    description: typeof fm.description === 'string' ? fm.description : '',
    // Only carry `model` when actually declared, so prompts without it stay
    // shape-identical to before (no `model` key).
    ...(typeof fm.model === 'string' ? { model: fm.model } : {}),
    body: m[2].trim()
  }
}

export function loadPrompts(dir: string): PromptTemplate[] {
  if (!dir || !existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.md') && !f.startsWith('_'))
    .map((f) => parseFrontmatter(readFileSync(join(dir, f), 'utf8'), f.replace(/\.md$/i, '')))
}

export function findPrompt(prompts: PromptTemplate[], name: string): PromptTemplate | undefined {
  return prompts.find((p) => p.name === name)
}
