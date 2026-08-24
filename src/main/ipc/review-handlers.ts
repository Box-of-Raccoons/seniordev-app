import { ipcMain } from 'electron'
import { REVIEW, type ReviewTreeInfo, type ReviewDiffInfo } from '../../shared/ipc'
import type { GitRunner } from '../git/git-runner'
import { reviewSummary, reviewDiff, groupTargetsByTree, type ReviewTarget, type FileReader } from '../git/review-service'
import { nodeFileReader } from '../git/node-file-reader'
import type { SessionPersistence } from '../session-persistence'

// Supervision epic, slice 1. Read-only: every handler here runs `git diff` or
// `git ls-files` and nothing else. The renderer never shells git; it goes through
// the injected GitRunner, same seam registerWorktreeIpc uses.

// A stored conversation's review target is its WORKTREE when it ran in one,
// because that is the tree holding its changes; otherwise the folder it ran in.
export function targetsFromConversations(
  conversations: { id: string; title: string; tool: string; cwd: string; worktreePath: string | null; branch: string | null; archivedAt: number | null }[]
): ReviewTarget[] {
  return conversations
    .filter((c) => c.archivedAt === null)
    .map((c) => ({
      conversationId: c.id,
      title: c.title,
      cwd: c.worktreePath ?? c.cwd,
      branch: c.branch,
      tool: c.tool
    }))
    .filter((t) => !!t.cwd)
}

export function registerReviewIpc(deps: {
  gitRunner: GitRunner
  persistence: SessionPersistence
  // Injectable so a test can supply untracked file contents without touching
  // disk; defaults to the real reader.
  readFile?: FileReader
}): void {
  // Every tree with pending changes. Trees that are clean are dropped, so the
  // overview lists only what actually needs reviewing; a tree git could not read
  // is KEPT, carrying its error, because silently omitting it would read as clean.
  ipcMain.handle(REVIEW.list, async (): Promise<ReviewTreeInfo[]> => {
    const groups = groupTargetsByTree(targetsFromConversations(deps.persistence.conversations.list()))
    const out: ReviewTreeInfo[] = []
    for (const g of groups) {
      const rep = g.sessions[0]
      const s = await reviewSummary(
        deps.gitRunner,
        {
          conversationId: rep.conversationId,
          title: rep.title,
          cwd: g.cwd,
          branch: g.branch,
          tool: rep.tool
        },
        deps.readFile ?? nodeFileReader
      )
      if (!s.error && s.files === 0) continue
      out.push({
        cwd: g.cwd,
        branch: s.branch,
        sessions: g.sessions,
        files: s.files,
        insertions: s.insertions,
        deletions: s.deletions,
        entries: s.entries,
        untrackedTruncated: s.untrackedTruncated,
        error: s.error
      })
    }
    return out
  })

  ipcMain.handle(REVIEW.diff, async (_e, cwd: string, path: string | null): Promise<ReviewDiffInfo> => {
    const r = await reviewDiff(deps.gitRunner, cwd, path ?? null)
    return { files: r.files, error: r.error }
  })
}
