import { createProjectsStore, type ProjectsStore } from './store/projects-store'
import { createConversationsStore, type ConversationsStore } from './store/conversations-store'
import { pollForCodexSession, findRolloutSession, codexSessionsDir } from './codex/session-discovery'
import { computeArchivals } from './archive'

// Backfill window (spec §7.1): the live discovery poll anchors at spawn and can
// lose the race — its ~20s window closes before codex's rollout file is catchable,
// so a real codex session ends up with a null agentSessionId (shown inert). The
// rollout persists on disk, so we re-scan later, anchored at the conversation's
// createdAt (≈ spawn). Kept tight so two codex sessions in the same folder minutes
// apart don't cross-match; a rollout for a spawn appears within seconds of it.
const BACKFILL_SLACK_MS = 3000
const BACKFILL_WINDOW_MS = 30000

// Ties the project + conversation stores to the two session-id acquisition paths
// (spec section 7.1). One call per agent-tab spawn: auto-create/refresh the
// project, upsert the conversation, and capture the agent's resume id — immediately
// for a pre-assigned tool (claude), asynchronously via rollout discovery otherwise
// (codex). Discovery is best-effort: a null result leaves agentSessionId null,
// which is the correct "no resume available" state.
export interface AgentSpawnInfo {
  conversationId: string
  tool: string
  cwd: string
  title: string
  // The pty id, so a project can be marked live (never auto-archived) until this
  // tab exits. Optional for tests that only exercise id capture.
  ptyId?: string
  // Present when the launch pre-assigned the id on argv (claude --session-id):
  // it is the id (== conversationId), stored at once. Absent ⇒ discover it.
  preAssignedSessionId?: string
  // S5: set when the launch ran in a git worktree — recorded on the conversation
  // so teardown can offer to remove it. worktreeDefault is the Task-mode checkbox
  // state (present only for a Task-mode agent launch); it updates the project's
  // remembered choice. Absent on every other launch, so those never clobber it.
  worktreePath?: string
  branch?: string
  worktreeDefault?: boolean
}

export interface SessionPersistence {
  projects: ProjectsStore
  conversations: ConversationsStore
  onAgentSpawn(info: AgentSpawnInfo): void
  // A pty exited or was killed: its project is no longer pinned live.
  onTabExit(ptyId: string): void
  // Re-attempt codex id discovery from the on-disk rollout for any codex
  // conversation still missing one (the live poll can lose the race). Returns how
  // many ids were backfilled. Idempotent; safe to call repeatedly.
  backfillCodexSessions(): number
  // Archive projects idle past archiveAfterDays, exempting any with a live tab
  // (spec 4.5). Reversible; 0 days disables. Returns the archived project ids.
  runArchive(archiveAfterDays: number): string[]
  // Best-effort: force both stores to disk (before-quit).
  flush(): void
}

export function createSessionPersistence(deps?: {
  projects?: ProjectsStore
  conversations?: ConversationsStore
  sessionsDir?: string
  now?: () => number
  // Injectable for tests; defaults to the real codex rollout poll.
  discover?: (opts: { sessionsDir: string; cwd: string; since: number }) => Promise<string | null>
  // Fired whenever the stored project/conversation set changes in a way the S4
  // sidebar should reflect: a spawn upserted a record, codex discovery filled an
  // agentSessionId, or the archive job archived a project. index.ts wires this to
  // a SIDEBAR.changed push so the sidebar re-fetches. Best-effort; never throws.
  onChange?: () => void
}): SessionPersistence {
  const projects = deps?.projects ?? createProjectsStore()
  const conversations = deps?.conversations ?? createConversationsStore()
  const now = deps?.now ?? Date.now
  const sessionsDir = deps?.sessionsDir ?? codexSessionsDir()
  const discover = deps?.discover ?? ((o): Promise<string | null> => pollForCodexSession(o))
  const emitChange = (): void => {
    try {
      deps?.onChange?.()
    } catch {
      /* a refresh nudge failing must never break persistence */
    }
  }

  // Fill in codex ids the live poll missed, by re-scanning the on-disk rollouts.
  // Pure of the emit — callers decide when to nudge the sidebar.
  function backfillCodex(): number {
    let changed = 0
    for (const c of conversations.list()) {
      if (c.tool !== 'codex' || c.agentSessionId !== null || c.archivedAt !== null) continue
      let id: string | null = null
      try {
        id = findRolloutSession({
          sessionsDir,
          cwd: c.cwd,
          since: c.createdAt - BACKFILL_SLACK_MS,
          until: c.createdAt + BACKFILL_WINDOW_MS
        })
      } catch {
        id = null // any scan failure → leave it unresumable, never throw
      }
      if (id) {
        conversations.setAgentSessionId(c.id, id)
        changed += 1
      }
    }
    return changed
  }
  // Live tabs pin their project against archiving. ptyId -> projectId; a project
  // is "live" while any of its ptys is running.
  const livePtys = new Map<string, string>()

  return {
    projects,
    conversations,
    onAgentSpawn(info) {
      const project = projects.ensureForCwd(info.cwd, { defaultTool: info.tool })
      if (info.ptyId) livePtys.set(info.ptyId, project.id)
      // Remember the last per-project worktree choice, but only when the launch
      // actually carried one (a Task-mode agent launch). Other launches leave it.
      if (info.worktreeDefault !== undefined) projects.setWorktreeDefault(project.id, info.worktreeDefault)
      conversations.upsert({
        id: info.conversationId,
        projectId: project.id,
        title: info.title,
        tool: info.tool,
        cwd: info.cwd,
        agentSessionId: info.preAssignedSessionId ?? null,
        // Pass through undefined (not null) when absent so a resume of a worktree
        // conversation — which re-enters here with no worktree fields — leaves the
        // stored worktreePath/branch intact rather than wiping them.
        worktreePath: info.worktreePath,
        branch: info.branch
      })
      // The project + conversation now exist / are refreshed → the sidebar has a
      // new (or re-activated) row to draw.
      emitChange()
      // claude: id is already known (pre-assigned == conversationId). Done.
      if (info.preAssignedSessionId) return
      // codex (or any non-pre-assign tool): poll the rollout dir from spawn. A
      // non-codex tool simply writes no rollout there → null → no resume, harmless.
      const since = now()
      void discover({ sessionsDir, cwd: info.cwd, since })
        .then((sid) => {
          if (sid) {
            conversations.setAgentSessionId(info.conversationId, sid)
            // The row is now resumable — refresh so its dimmed/inert state clears.
            emitChange()
          }
        })
        .catch(() => {
          /* discovery is best-effort; a failure means no resume available */
        })
    },
    onTabExit(ptyId) {
      livePtys.delete(ptyId)
      // A just-ended codex session's rollout is now fully on disk, so retry any id
      // the live poll missed. And any finished session's resumability may have
      // changed (claude wrote its transcript once it had content). Either way,
      // re-fetch so the sidebar reflects the new state.
      backfillCodex()
      emitChange()
    },
    backfillCodexSessions() {
      const changed = backfillCodex()
      if (changed) emitChange()
      return changed
    },
    runArchive(archiveAfterDays) {
      const liveProjectIds = new Set(livePtys.values())
      const ids = computeArchivals({ projects: projects.list(), now: now(), archiveAfterDays, liveProjectIds })
      for (const id of ids) projects.setArchived(id, true)
      // A project moved into the Archived section → the sidebar must repartition.
      if (ids.length) emitChange()
      return ids
    },
    flush() {
      projects.flush()
      conversations.flush()
    }
  }
}
