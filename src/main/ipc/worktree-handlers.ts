import { ipcMain } from 'electron'
import {
  WORKTREE,
  SIDEBAR,
  type WorktreeInfo,
  type WorktreeCreateRequest,
  type WorktreeCreateResult,
  type WorktreeTeardownRequest,
  type WorktreeTeardownResult
} from '../../shared/ipc'
import type { GitRunner } from '../git/git-runner'
import { gitRepoInfo, createWorktree, removeWorktree } from '../git/worktree-service'
import type { ConfigSource } from '../config/store'
import { findRepoForPath, normRepoPath } from '../config/repos'
import { titleFromPath } from '../store/projects-store'
import type { SessionPersistence } from '../session-persistence'

// S5 worktree toggle (spec section 9). The renderer never shells git; every git op
// goes through the injected GitRunner here (mirrors registerTerminalIpc taking a
// PtySpawner). `info` is resolved live and cached ~60s — spec 4.3 keeps no stored
// git state. `create` is the pre-flight the composer awaits before morphing.
// `teardown` archives a conversation and optionally removes its worktree.
const INFO_TTL_MS = 60_000

export function registerWorktreeIpc(deps: {
  gitRunner: GitRunner
  source: ConfigSource
  persistence: SessionPersistence
  configDir: string
  getSender: () => Electron.WebContents | undefined
  // Injectable clock so the TTL cache is testable without the wall clock.
  now?: () => number
}): void {
  const now = deps.now ?? Date.now
  const infoCache = new Map<string, { at: number; value: WorktreeInfo }>()

  // The remembered per-project worktree choice for a folder, matched by normalized
  // path against the projects store (auto-created projects are keyed by path).
  function worktreeDefaultFor(folder: string): boolean {
    const norm = normRepoPath(folder)
    return deps.persistence.projects.list().some((p) => normRepoPath(p.path) === norm && p.worktreeDefault)
  }

  ipcMain.handle(WORKTREE.info, async (_e, folder: string): Promise<WorktreeInfo> => {
    const key = normRepoPath(folder)
    const cached = infoCache.get(key)
    if (cached && now() - cached.at < INFO_TTL_MS) return cached.value
    const { isRepo } = await gitRepoInfo(deps.gitRunner, folder)
    const repo = deps.source.config ? findRepoForPath(deps.source.config, folder) : null
    const value: WorktreeInfo = {
      isRepo,
      branchPrefix: repo?.branchPrefix ?? '',
      worktreeDefault: worktreeDefaultFor(folder)
    }
    infoCache.set(key, { at: now(), value })
    return value
  })

  ipcMain.handle(WORKTREE.create, async (_e, req: WorktreeCreateRequest): Promise<WorktreeCreateResult> => {
    const repo = deps.source.config ? findRepoForPath(deps.source.config, req.folder) : null
    const repoKey = repo?.key ?? titleFromPath(req.folder)
    return await createWorktree(deps.gitRunner, {
      configDir: deps.configDir,
      folder: req.folder,
      repoKey,
      branch: req.branch
    })
  })

  ipcMain.handle(WORKTREE.teardown, async (_e, req: WorktreeTeardownRequest): Promise<WorktreeTeardownResult> => {
    const conv = deps.persistence.conversations.get(req.conversationId)
    if (!conv) return { archived: false }
    // Archive first (reversible; data kept per spec 4.6). This always succeeds and
    // is never blocked by a worktree-removal failure — the pointer leaves the list
    // even if a dirty worktree stays on disk.
    deps.persistence.conversations.setArchived(req.conversationId, true)
    const result: WorktreeTeardownResult = { archived: true }
    if (req.removeWorktree && conv.worktreePath) {
      const project = deps.persistence.projects.get(conv.projectId)
      // Run the removal from the main repo (project path), not the worktree itself.
      const folder = project?.path ?? conv.cwd
      result.worktree = await removeWorktree(deps.gitRunner, { folder, worktreePath: conv.worktreePath })
    }
    deps.getSender()?.send(SIDEBAR.changed)
    return result
  })
}
