import { createProjectsStore, type ProjectsStore } from './store/projects-store'
import { createConversationsStore, type ConversationsStore } from './store/conversations-store'
import { pollForCodexSession, codexSessionsDir } from './codex/session-discovery'

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
  // Present when the launch pre-assigned the id on argv (claude --session-id):
  // it is the id (== conversationId), stored at once. Absent ⇒ discover it.
  preAssignedSessionId?: string
}

export interface SessionPersistence {
  projects: ProjectsStore
  conversations: ConversationsStore
  onAgentSpawn(info: AgentSpawnInfo): void
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

  return {
    projects,
    conversations,
    onAgentSpawn(info) {
      const project = projects.ensureForCwd(info.cwd, { defaultTool: info.tool })
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
    flush() {
      projects.flush()
      conversations.flush()
    }
  }
}
