import type { DiffLineKind, DiffStatus } from '../../shared/diff-parse'

// Pure display helpers for the review tab. Kept out of the component so the
// colour-independence rules (DESIGN.md: state is never conveyed by colour alone)
// are asserted directly rather than inferred from a rendered class.

// The folder name a tree is known by. Handles both separators because a Windows
// path can reach a macOS render through a synced config, and vice versa.
export function treeLabel(cwd: string): string {
  const trimmed = cwd.replace(/[\\/]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return idx === -1 ? trimmed : trimmed.slice(idx + 1)
}

export function describeChanges(t: { files: number; insertions: number; deletions: number }): string {
  const files = `${t.files} file${t.files === 1 ? '' : 's'}`
  return `${files}, +${t.insertions} -${t.deletions}`
}

// The sessions that ran in a tree. More than two collapses, because the tree is
// the unit being reviewed and the full list belongs in the detail view.
export function describeSessions(sessions: { title: string }[]): string {
  if (sessions.length === 0) return ''
  if (sessions.length === 1) return sessions[0].title
  if (sessions.length === 2) return `${sessions[0].title}, ${sessions[1].title}`
  return `${sessions[0].title} and ${sessions.length - 1} more`
}

// A letter per file status, so the status reads without colour. Mirrors git's own
// short-status vocabulary, which anyone using this app already knows.
const STATUS_MARKS: Record<DiffStatus, string> = {
  added: 'A',
  deleted: 'D',
  modified: 'M',
  renamed: 'R'
}
export function statusMark(status: DiffStatus): string {
  return STATUS_MARKS[status] ?? 'M'
}

const STATUS_LABELS: Record<DiffStatus, string> = {
  added: 'added',
  deleted: 'deleted',
  modified: 'modified',
  renamed: 'renamed'
}
export function statusLabel(status: DiffStatus): string {
  return STATUS_LABELS[status] ?? 'modified'
}

// The gutter glyph for a diff line. This is the load-bearing half of the
// colour rule: green and rust reinforce it, they never carry it.
const LINE_MARKS: Record<DiffLineKind, string> = { add: '+', del: '-', context: ' ' }
export function lineMark(kind: DiffLineKind): string {
  return LINE_MARKS[kind] ?? ' '
}

// Width of the line-number gutter, sized to the widest number actually present so
// a small diff does not carry a five-digit column.
export function lineNumberWidth(files: { hunks: { lines: { oldLine: number | null; newLine: number | null }[] }[] }[]): number {
  let max = 0
  for (const f of files) {
    for (const h of f.hunks) {
      for (const l of h.lines) {
        if (l.oldLine && l.oldLine > max) max = l.oldLine
        if (l.newLine && l.newLine > max) max = l.newLine
      }
    }
  }
  return Math.max(2, String(max).length)
}
