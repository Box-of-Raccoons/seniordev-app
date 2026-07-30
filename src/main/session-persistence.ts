import { createProjectsStore, type ProjectsStore } from './store/projects-store'
import { createConversationsStore, type ConversationsStore } from './store/conversations-store'
import { pollForCodexSession, codexSessionsDir } from './codex/session-discovery'
import { computeArchivals } from './archive'

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
}

export interface SessionPersistence {
  projects: ProjectsStore
  conversations: ConversationsStore
  onAgentSpawn(info: AgentSpawnInfo): void
  // A pty exited or was killed: its project is no longer pinned live.
  onTabExit(ptyId: string): void
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
}): SessionPersistence {
  const projects = deps?.projects ?? createProjectsStore()
  const conversations = deps?.conversations ?? createConversationsStore()
  const now = deps?.now ?? Date.now
  const sessionsDir = deps?.sessionsDir ?? codexSessionsDir()
  const discover = deps?.discover ?? ((o): Promise<string | null> => pollForCodexSession(o))
  // Live tabs pin their project against archiving. ptyId -> projectId; a project
  // is "live" while any of its ptys is running.
  const livePtys = new Map<string, string>()

  return {
    projects,
    conversations,
    onAgentSpawn(info) {
      const project = projects.ensureForCwd(info.cwd, { defaultTool: info.tool })
      if (info.ptyId) livePtys.set(info.ptyId, project.id)
      conversations.upsert({
        id: info.conversationId,
        projectId: project.id,
        title: info.title,
        tool: info.tool,
        cwd: info.cwd,
        agentSessionId: info.preAssignedSessionId ?? null
      })
      // claude: id is already known (pre-assigned == conversationId). Done.
      if (info.preAssignedSessionId) return
      // codex (or any non-pre-assign tool): poll the rollout dir from spawn. A
      // non-codex tool simply writes no rollout there → null → no resume, harmless.
      const since = now()
      void discover({ sessionsDir, cwd: info.cwd, since })
        .then((sid) => {
          if (sid) conversations.setAgentSessionId(info.conversationId, sid)
        })
        .catch(() => {
          /* discovery is best-effort; a failure means no resume available */
        })
    },
    onTabExit(ptyId) {
      livePtys.delete(ptyId)
    },
    runArchive(archiveAfterDays) {
      const liveProjectIds = new Set(livePtys.values())
      const ids = computeArchivals({ projects: projects.list(), now: now(), archiveAfterDays, liveProjectIds })
      for (const id of ids) projects.setArchived(id, true)
      return ids
    },
    flush() {
      projects.flush()
      conversations.flush()
    }
  }
}
