// Pure parsers for git's unified-diff and --numstat output, shared/ so both the
// main-side review service and the renderer's review tab read the same shapes.
// Everything here is total: malformed input yields fewer entries, never a throw.
// A review surface that crashes on an odd diff is worse than one that shows less.

export type DiffLineKind = 'add' | 'del' | 'context'
export type DiffStatus = 'added' | 'deleted' | 'modified' | 'renamed'

export interface DiffLine {
  kind: DiffLineKind
  // Content with git's leading +/-/space marker removed. The marker is carried in
  // `kind` instead, so the renderer can draw a gutter glyph rather than relying on
  // colour alone (DESIGN.md: state is never conveyed by colour alone).
  text: string
  oldLine: number | null
  newLine: number | null
}

export interface DiffHunk {
  header: string // the raw @@ line, kept verbatim for display
  lines: DiffLine[]
}

export interface DiffFile {
  path: string // destination path; for a delete, the path that went away
  oldPath: string | null // set only on a rename
  status: DiffStatus
  binary: boolean
  hunks: DiffHunk[]
  insertions: number
  deletions: number
}

export interface NumstatEntry {
  path: string
  insertions: number
  deletions: number
  binary: boolean
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

// `diff --git a/<old> b/<new>` is genuinely ambiguous when a path contains a
// space, because git quotes neither side. Resolve it by trying every " b/"
// boundary and keeping the split where both halves name the SAME path, which is
// the case for every non-rename. Renames are read from their `rename from`/
// `rename to` lines instead, so the ambiguity never has to be resolved here.
function pathsFromGitHeader(rest: string): { oldPath: string; newPath: string } | null {
  for (let i = rest.indexOf(' b/'); i !== -1; i = rest.indexOf(' b/', i + 1)) {
    const left = rest.slice(0, i)
    const right = rest.slice(i + 1)
    if (!left.startsWith('a/')) continue
    const o = left.slice(2)
    const n = right.slice(2)
    if (o === n) return { oldPath: o, newPath: n }
  }
  return null
}

// Strip git's a/ or b/ prefix from a ---/+++ path line. /dev/null stays as-is so
// the caller can read it as an add or delete signal.
//
// A TAB terminates the path. Unified diff allows `+++ b/path\t<timestamp>`, and
// git emits the tab for paths containing spaces even with no timestamp after
// it. Keeping it put a trailing tab inside DiffFile.path, which then failed to
// match the same file's numstat-derived entry.
function stripPrefix(p: string): string {
  const untabbed = p.split('\t')[0]
  if (untabbed === '/dev/null') return untabbed
  return untabbed.startsWith('a/') || untabbed.startsWith('b/') ? untabbed.slice(2) : untabbed
}

function emptyFile(): DiffFile {
  return {
    path: '',
    oldPath: null,
    status: 'modified',
    binary: false,
    hunks: [],
    insertions: 0,
    deletions: 0
  }
}

export function parseUnifiedDiff(text: string): DiffFile[] {
  if (!text.trim()) return []

  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let hunk: DiffHunk | null = null
  let oldNo = 0
  let newNo = 0
  // Old and new paths as seen on the ---/+++ lines, held until the file is
  // pushed: /dev/null on either side is what distinguishes an add from a delete.
  let minus: string | null = null
  let plus: string | null = null

  const finish = (): void => {
    if (!file) return
    if (minus === '/dev/null') file.status = 'added'
    else if (plus === '/dev/null') file.status = 'deleted'
    if (file.status !== 'renamed') {
      const named = plus && plus !== '/dev/null' ? plus : minus && minus !== '/dev/null' ? minus : null
      if (named) file.path = named
    }
    files.push(file)
    file = null
    hunk = null
    minus = null
    plus = null
  }

  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw

    if (line.startsWith('diff --git ')) {
      finish()
      file = emptyFile()
      const paths = pathsFromGitHeader(line.slice('diff --git '.length))
      if (paths) file.path = paths.newPath
      continue
    }
    if (!file) continue

    // Extended headers, before any hunk.
    if (line.startsWith('new file mode')) {
      file.status = 'added'
      continue
    }
    if (line.startsWith('deleted file mode')) {
      file.status = 'deleted'
      continue
    }
    if (line.startsWith('rename from ')) {
      file.status = 'renamed'
      file.oldPath = line.slice('rename from '.length)
      continue
    }
    if (line.startsWith('rename to ')) {
      file.status = 'renamed'
      file.path = line.slice('rename to '.length)
      continue
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      file.binary = true
      continue
    }
    if (line.startsWith('--- ')) {
      minus = stripPrefix(line.slice(4))
      continue
    }
    if (line.startsWith('+++ ')) {
      plus = stripPrefix(line.slice(4))
      continue
    }

    const m = HUNK_RE.exec(line)
    if (m) {
      hunk = { header: line, lines: [] }
      file.hunks.push(hunk)
      oldNo = Number(m[1])
      newNo = Number(m[3])
      continue
    }

    if (!hunk) continue

    // "\ No newline at end of file" annotates the preceding line; it is not a
    // line of the file and must not be counted as one.
    if (line.startsWith('\\')) continue

    if (line.startsWith('+')) {
      hunk.lines.push({ kind: 'add', text: line.slice(1), oldLine: null, newLine: newNo++ })
      file.insertions++
    } else if (line.startsWith('-')) {
      hunk.lines.push({ kind: 'del', text: line.slice(1), oldLine: oldNo++, newLine: null })
      file.deletions++
    } else if (line.startsWith(' ')) {
      hunk.lines.push({ kind: 'context', text: line.slice(1), oldLine: oldNo++, newLine: newNo++ })
    }
    // Anything else is ignored, including the bare '' that split('\n') leaves on
    // trailing-newline input. An EMPTY context line is still " " in git's output,
    // so treating '' as context would only ever swallow that artefact.
  }
  finish()
  return files
}

// A rename shows up inside numstat's path column, either as "old => new" or in
// the compacted brace form "dir/{old => new}/file". Both resolve to the
// destination path, which is what the overview lists.
function renameDestination(path: string): string {
  const braced = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(path)
  if (braced) return `${braced[1]}${braced[3]}${braced[4]}`.replace(/\/\//g, '/')
  const arrow = path.indexOf(' => ')
  return arrow === -1 ? path : path.slice(arrow + 4)
}

export function parseNumstat(text: string): NumstatEntry[] {
  const out: NumstatEntry[] = []
  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (!line.trim()) continue
    // Exactly three tab-separated columns; a path containing a tab is pathological
    // and not worth defending against, but a path containing spaces is common and
    // survives because only tabs split.
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const [ins, del] = parts
    const path = parts.slice(2).join('\t')
    const binary = ins === '-' && del === '-'
    const insertions = binary ? 0 : Number(ins)
    const deletions = binary ? 0 : Number(del)
    if (!binary && (!Number.isFinite(insertions) || !Number.isFinite(deletions))) continue
    if (!path) continue
    out.push({ path: renameDestination(path), insertions, deletions, binary })
  }
  return out
}

export function totalChanges(entries: NumstatEntry[]): {
  files: number
  insertions: number
  deletions: number
} {
  let insertions = 0
  let deletions = 0
  for (const e of entries) {
    insertions += e.insertions
    deletions += e.deletions
  }
  return { files: entries.length, insertions, deletions }
}
