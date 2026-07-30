import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

// Shared machinery for SeniorDev's persisted JSON stores (spec section 4.4).
// Generalises the exact contract recent-folders.ts already proved in production:
// atomic tmp+rename, best-effort (a locked/redirected config dir must never fail
// the launch), version:1 + migrate-on-read, and a debounce so a hot store
// (workspace.json on every tab move) is not rewritten per keystroke.

export interface VersionedDoc {
  version: number
}

// Best-effort read of a versioned JSON doc. ANY problem — missing file, bad JSON,
// wrong shape — funnels through migrate(undefined), which every store defines as
// its empty default. A corrupt store degrades to empty, never throws (mirrors
// loadRecent). migrate() also upgrades an older on-disk version to the current one.
export function loadJson<T extends VersionedDoc>(file: string, migrate: (raw: unknown) => T): T {
  try {
    return migrate(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return migrate(undefined)
  }
}

// Atomic best-effort write: tmp file then rename, so a reader never sees a
// half-written doc, and a write failure (locked dir, redirected %APPDATA%) is
// swallowed rather than crashing a launch. Mirrors recordRecent / writeFileAtomic.
export function writeJsonAtomic(file: string, data: unknown): void {
  try {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    renameSync(tmp, file)
  } catch {
    /* best-effort: a locked/redirected config dir must not fail the launch */
  }
}

export interface Debouncer {
  // (Re)start the timer; the wrapped fn runs once, delayMs after the last trigger.
  trigger(): void
  // Run any pending write immediately (used at before-quit and in tests).
  flush(): void
  // Drop a pending write without running it.
  cancel(): void
}

// Trailing-edge debounce that coalesces a burst of triggers into one call. Kept
// tiny and injectable-free; tests drive it with vitest fake timers.
export function debounce(fn: () => void, delayMs: number): Debouncer {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    trigger() {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        fn()
      }, delayMs)
    },
    flush() {
      if (timer) {
        clearTimeout(timer)
        timer = null
        fn()
      }
    },
    cancel() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }
  }
}

export interface JsonStore<T extends VersionedDoc> {
  // The live in-memory doc. Read freely; mutate only through mutate() so a write
  // is scheduled.
  get(): T
  // Mutate the doc and schedule a debounced persist. The callback receives the
  // live doc to edit in place.
  mutate(fn: (doc: T) => void): void
  // Persist immediately, cancelling any pending debounce (before-quit / tests).
  flush(): void
}

// A file-backed store: loads (and migrates) on construction, holds the doc in
// memory, and debounce-persists on every mutate(). One instance per file.
export function createJsonStore<T extends VersionedDoc>(opts: {
  file: string
  migrate: (raw: unknown) => T
  debounceMs?: number
}): JsonStore<T> {
  const doc = loadJson(opts.file, opts.migrate)
  const writer = debounce(() => writeJsonAtomic(opts.file, doc), opts.debounceMs ?? 500)
  return {
    get: () => doc,
    mutate(fn) {
      fn(doc)
      writer.trigger()
    },
    flush() {
      writer.flush()
    }
  }
}
