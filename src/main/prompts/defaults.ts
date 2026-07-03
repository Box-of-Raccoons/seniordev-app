import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Prompt files that ship with the app (committed under resources/prompts and
// bundled into the installer via electron-builder extraResources). On boot we
// copy any that the user doesn't already have into their promptsDir, so a fresh
// install has the role library available without any manual setup.
//
// Pure and non-destructive: reads .md files from `sourceDir` and writes only the
// ones MISSING from `targetDir`. It never overwrites — a prompt the user has
// edited (or deliberately deleted and re-created) is left untouched — so it is
// safe to run on every launch. `_`-prefixed specials (e.g. _ticket-context.md)
// and non-.md files are ignored, matching loadPrompts' filter. Returns the names
// (without .md) it actually seeded, for logging.
export function seedDefaultPrompts(sourceDir: string, targetDir: string): string[] {
  if (!sourceDir || !existsSync(sourceDir)) return []
  const seeded: string[] = []
  for (const f of readdirSync(sourceDir)) {
    if (!f.toLowerCase().endsWith('.md') || f.startsWith('_')) continue
    const dest = join(targetDir, f)
    if (existsSync(dest)) continue
    mkdirSync(targetDir, { recursive: true })
    copyFileSync(join(sourceDir, f), dest)
    seeded.push(f.replace(/\.md$/i, ''))
  }
  return seeded
}
