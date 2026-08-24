import { lstat, readFile, readlink } from 'node:fs/promises'
import { resolve, relative, isAbsolute } from 'node:path'
import type { FileReader } from './review-service'

// The ONLY module here that reads working-tree files. Never import it from a
// test; tests pass a fake FileReader to reviewSummary (mirrors node-git-runner).

// A file bigger than this is not counted line by line. An untracked artefact
// can be a multi-hundred-megabyte build output, and pulling that into main to
// count its newlines is exactly the freeze this change exists to remove. The
// file is still LISTED, flagged uncounted, so it never reads as empty.
export const MAX_COUNT_BYTES = 8 * 1024 * 1024

export const nodeFileReader: FileReader = async (cwd, relPath) => {
  // The path comes from `git ls-files`, so it is already tree-relative. Resolve
  // it anyway and confirm it stays inside the tree.
  const root = resolve(cwd)
  const target = resolve(root, relPath)
  const rel = relative(root, target)
  if (rel.startsWith('..') || isAbsolute(rel)) return { kind: 'unreadable' }

  try {
    // lstat, NOT stat. The containment check above is lexical, so a symlink
    // passes it while a following read would open the target — which can sit
    // outside the tree entirely, breaking the invariant this check exists for.
    const st = await lstat(target)

    if (st.isSymbolicLink()) {
      // git stores a symlink's blob as the TARGET PATH text, so `git diff
      // --no-index --numstat` reports 1 line for one. Returning the link text
      // reproduces that, and never reads whatever it points at.
      return { kind: 'text', content: await readlink(target) }
    }
    if (!st.isFile()) return { kind: 'unreadable' }
    if (st.size > MAX_COUNT_BYTES) return { kind: 'too-large' }

    return { kind: 'text', content: await readFile(target, 'utf8') }
  } catch {
    // Vanished mid-scan, a permission error, or a dangling link. All normal
    // while an agent is actively writing; none are worth failing the review.
    return { kind: 'unreadable' }
  }
}
