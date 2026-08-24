import { readFileSync, statSync } from 'node:fs'
import { join, resolve, relative, isAbsolute } from 'node:path'
import type { FileReader } from './review-service'

// The ONLY module here that reads working-tree files. Never import it from a
// test; tests pass a fake FileReader to reviewSummary (mirrors node-git-runner).

// A file bigger than this is not counted line by line. An untracked artefact
// can be a multi-hundred-megabyte build output, and pulling that into main to
// count its newlines is exactly the freeze this change exists to remove.
export const MAX_COUNT_BYTES = 8 * 1024 * 1024

export const nodeFileReader: FileReader = (cwd, relPath) => {
  // The path comes from `git ls-files`, so it is already tree-relative. Resolve
  // it anyway and confirm it stays inside the tree: a path that escapes would
  // mean reading a file the review has no business touching.
  const target = resolve(cwd, relPath)
  const rel = relative(resolve(cwd), target)
  if (rel.startsWith('..') || isAbsolute(rel)) return null

  try {
    if (statSync(target).size > MAX_COUNT_BYTES) {
      // Reported as unreadable, which lists the file with no counts rather
      // than pretending it has none.
      return null
    }
    return readFileSync(join(cwd, relPath), 'utf8')
  } catch {
    // Vanished mid-scan, a permission error, or a symlink to nowhere. All
    // normal while an agent is actively writing; none of them are worth
    // failing the whole review over.
    return null
  }
}
