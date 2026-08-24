import type { GitRunner } from './git-runner'
import { parseNumstat, parseUnifiedDiff, type DiffFile, type NumstatEntry } from '../../shared/diff-parse'

// Read-only review over a session's working tree (supervision epic, slice 1).
// Every call is a `git diff` or a `git ls-files`; nothing here stages, commits, or
// removes anything, which is the v1 scope decision in the design doc. The runner
// is injected so tests never shell real git (mirrors worktree-service.ts).

// Untracked files are counted one `git diff --no-index` at a time, so a folder
// with an unignored node_modules could otherwise cost thousands of spawns. The
// cap keeps the overview responsive; `untrackedTruncated` reports what was
// dropped rather than letting the list look complete when it is not.
export const UNTRACKED_CAP = 100

// Every git call here is prefixed with this. With git's default
// `core.quotepath=true`, a non-ASCII filename comes back C-quoted and
// octal-escaped ("utf8\303\261.txt"), which we would then hand straight back to
// `git diff -- <path>` as a literal — matching nothing, so a file with real
// changes silently showed an empty diff. Turning quoting off makes the paths we
// parse the same bytes as the paths we pass back.
const QUOTEPATH_OFF = ['-c', 'core.quotepath=off']
function git(runner: GitRunner, cwd: string, args: string[]): ReturnType<GitRunner> {
  return runner(cwd, [...QUOTEPATH_OFF, ...args])
}

// Reads one untracked file's contents. Injected rather than imported so the
// counting stays pure and testable; the real implementation lives in
// node-file-reader.ts, the only module here that touches fs.
export type FileReader = (cwd: string, relPath: string) => string | null

// What an untracked file contributes to the review. An untracked file is
// ENTIRELY added lines, so its whole contribution is its line count. That used
// to come from `git diff --no-index --numstat` per file, which is one process
// spawn each: measured at 284ms for 100 files against 1ms to count them here.
// Main is single-threaded and hosts the ptys, so those 283ms were 283ms of
// frozen terminal output for every running agent.
export function countUntracked(content: string): { lines: number; binary: boolean } {
  // A null byte is the same heuristic git itself uses to call a file binary.
  // It is not perfect, and it does not need to be: the consequence of being
  // wrong is a line count shown for a file that should have said "binary".
  if (/\u0000/.test(content)) return { lines: 0, binary: true }
  if (content === '') return { lines: 0, binary: false }
  // git counts a trailing newline as terminating the last line, not starting a
  // new one, so "a\nb\n" is two lines and "a\nb" is also two.
  const newlines = content.split('\n').length - 1
  return { lines: content.endsWith('\n') ? newlines : newlines + 1, binary: false }
}

export interface ReviewTarget {
  conversationId: string
  title: string
  // The worktree path when the session ran in one, else the project folder.
  cwd: string
  branch: string | null
  tool: string
}

export interface ReviewEntry extends NumstatEntry {
  // Untracked files have no HEAD side, so their diff comes from --no-index and
  // their counts are whole-file. The flag rides along so the UI can say so.
  untracked: boolean
}

export interface ReviewSummary {
  conversationId: string
  title: string
  cwd: string
  branch: string | null
  files: number
  insertions: number
  deletions: number
  entries: ReviewEntry[]
  untrackedTruncated: number
  // Non-null when git could not answer at all (folder gone, not a repo). The UI
  // shows the reason instead of an empty, falsely-clean review.
  error: string | null
}

export interface ReviewDiffResult {
  files: DiffFile[]
  error: string | null
}

export interface ReviewGroup {
  cwd: string
  branch: string | null
  // Every session that ran in this tree, newest target first. More than one is
  // normal: resuming a conversation, or two tabs on the same folder.
  sessions: { conversationId: string; title: string; tool: string }[]
}

// Uncommitted changes belong to a WORKING TREE, not to a session. Two tabs open
// on the same folder share one diff, so listing them separately would show the
// same work twice and imply each session owned it. Group first, diff once.
// A session that ran in its own worktree keeps its own group by construction,
// because its cwd is the worktree path.
export function groupTargetsByTree(targets: ReviewTarget[]): ReviewGroup[] {
  const byCwd = new Map<string, ReviewGroup>()
  for (const t of targets) {
    if (!t.cwd) continue
    const existing = byCwd.get(t.cwd)
    if (existing) {
      existing.sessions.push({ conversationId: t.conversationId, title: t.title, tool: t.tool })
      // Keep the first non-null branch seen; git is asked for the live one anyway.
      if (!existing.branch) existing.branch = t.branch
      continue
    }
    byCwd.set(t.cwd, {
      cwd: t.cwd,
      branch: t.branch,
      sessions: [{ conversationId: t.conversationId, title: t.title, tool: t.tool }]
    })
  }
  return [...byCwd.values()]
}

// One line of git's stderr, for a message that fits on a status line.
function firstLine(s: string): string {
  return s.split('\n').find((l) => l.trim())?.trim() ?? 'git failed'
}

function isRepo(runner: GitRunner, cwd: string): string | null {
  const r = git(runner, cwd, ['rev-parse', '--is-inside-work-tree'])
  return r.code === 0 ? null : firstLine(r.stderr)
}

// The branch as git sees it now, which can differ from the branch recorded at
// launch (an agent may have switched). "HEAD" is what --abbrev-ref prints when
// detached, and reporting that verbatim would read as a branch named HEAD.
function currentBranch(runner: GitRunner, cwd: string, fallback: string | null): string | null {
  const r = git(runner, cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (r.code !== 0) return fallback
  const name = r.stdout.trim()
  if (!name) return fallback
  return name === 'HEAD' ? 'detached' : name
}

function untrackedPaths(runner: GitRunner, cwd: string): { paths: string[]; truncated: number } {
  const r = git(runner, cwd, ['ls-files', '--others', '--exclude-standard'])
  if (r.code !== 0) return { paths: [], truncated: 0 }
  const all = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean)
  return { paths: all.slice(0, UNTRACKED_CAP), truncated: Math.max(0, all.length - UNTRACKED_CAP) }
}

export function reviewSummary(
  runner: GitRunner,
  target: ReviewTarget,
  readFile: FileReader = () => null
): ReviewSummary {
  const base: ReviewSummary = {
    conversationId: target.conversationId,
    title: target.title,
    cwd: target.cwd,
    branch: target.branch,
    files: 0,
    insertions: 0,
    deletions: 0,
    entries: [],
    untrackedTruncated: 0,
    error: null
  }

  const notRepo = isRepo(runner, target.cwd)
  if (notRepo) return { ...base, error: notRepo }

  base.branch = currentBranch(runner, target.cwd, target.branch)

  // Tracked: staged and unstaged together, which is the whole of what the agent
  // changed but has not committed. Comparing against HEAD (not --cached) is what
  // makes a staged-but-uncommitted edit visible.
  const tracked = git(runner, target.cwd, ['diff', 'HEAD', '--numstat'])
  const entries: ReviewEntry[] = tracked.code === 0
    ? parseNumstat(tracked.stdout).map((e) => ({ ...e, untracked: false }))
    : []

  const { paths, truncated } = untrackedPaths(runner, target.cwd)
  for (const path of paths) {
    // Counted in-process rather than by spawning `git diff --no-index` per
    // file. An untracked file is entirely added lines, so a read and a newline
    // count give the same answer 284x faster and without blocking main on up
    // to 100 process spawns per tree.
    const content = readFile(target.cwd, path)
    if (content === null) {
      // Unreadable (vanished mid-scan, permissions): list it with no counts
      // rather than dropping it, since it is still uncommitted work.
      entries.push({ path, insertions: 0, deletions: 0, binary: false, untracked: true })
      continue
    }
    const { lines, binary } = countUntracked(content)
    entries.push({ path, insertions: lines, deletions: 0, binary, untracked: true })
  }

  let insertions = 0
  let deletions = 0
  for (const e of entries) {
    insertions += e.insertions
    deletions += e.deletions
  }

  return {
    ...base,
    entries,
    files: entries.length,
    insertions,
    deletions,
    untrackedTruncated: truncated
  }
}

export function reviewDiff(runner: GitRunner, cwd: string, path: string | null): ReviewDiffResult {
  const notRepo = isRepo(runner, cwd)
  if (notRepo) return { files: [], error: notRepo }

  const args = path ? ['diff', 'HEAD', '--', path] : ['diff', 'HEAD', '--']
  const r = git(runner, cwd, args)
  if (r.code !== 0 && !r.stdout) return { files: [], error: firstLine(r.stderr) }

  const files = parseUnifiedDiff(r.stdout)
  if (files.length > 0 || !path) return { files, error: null }

  // A tracked path always produces a diff against HEAD. An empty result for a
  // named path means it is untracked, so HEAD has no side to compare and the
  // whole file is the change.
  const untracked = git(runner, cwd, ['diff', '--no-index', '--', '/dev/null', path])
  return { files: parseUnifiedDiff(untracked.stdout), error: null }
}
