import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { defaultConfigDir } from './config/paths'

const MAX_RECENT = 8

// The store file: a small JSON list separate from config.yaml. config.yaml is
// user-authored (comments, hand-edited repos:) and must never be machine-written,
// so the churny recent-folders list lives on its own.
export function recentFoldersPath(): string {
  return join(defaultConfigDir(), 'recent-folders.json')
}

// Pure MRU update: most-recent first, case-insensitive dedupe, capped. A blank
// path is a no-op (a launch with no folder must not poison the list).
export function addRecent(list: string[], path: string, cap = MAX_RECENT): string[] {
  const p = path.trim()
  if (!p) return list.slice(0, cap)
  const rest = list.filter((f) => f.toLowerCase() !== p.toLowerCase())
  return [p, ...rest].slice(0, cap)
}

// Best-effort read: any problem (missing file, bad JSON, wrong shape) yields an
// empty list rather than throwing — a corrupt store must not break the composer.
export function loadRecent(file = recentFoldersPath()): string[] {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const arr = (raw as { folders?: unknown })?.folders
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

// Best-effort write: a locked or redirected %APPDATA% (corporate OneDrive roaming)
// must never block a launch, so a write failure is swallowed and the freshly
// computed list is still returned. Atomic tmp+rename mirrors writeFileAtomic in
// config-handlers.ts.
export function recordRecent(path: string, file = recentFoldersPath()): string[] {
  const next = addRecent(loadRecent(file), path)
  try {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify({ folders: next }, null, 2), 'utf8')
    renameSync(tmp, file)
  } catch {
    /* best-effort: a locked/redirected userData dir must not fail the launch */
  }
  return next
}
