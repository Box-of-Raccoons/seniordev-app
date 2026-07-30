import { createJsonStore, type JsonStore, type VersionedDoc } from './json-store'
import { conversationsPath } from './paths'

// A conversation is SeniorDev's pointer to an agent session it can resume (spec
// section 4.1). SeniorDev owns no transcript — claude and codex each persist their
// own — only this record and the agentSessionId needed to reattach. Kept in its
// own file (warm write frequency: one upsert per launch / id capture), separate
// from the hot workspace.json and the cold projects.json.
export interface Conversation {
  id: string // == the tab's conversationId (crypto.randomUUID)
  projectId: string
  title: string
  tool: string
  // The agent's own session id for resume. claude: == id, set at spawn. codex:
  // discovered post-hoc; null until found, and legitimately null forever for a
  // session where nothing was run.
  agentSessionId: string | null
  cwd: string
  worktreePath: string | null // S5
  branch: string | null // S5
  lastActiveAt: number
  createdAt: number
  archivedAt: number | null
}

export interface ConversationsDoc extends VersionedDoc {
  version: 1
  conversations: Conversation[]
}

function migrateConversations(raw: unknown): ConversationsDoc {
  const o = (raw ?? {}) as { conversations?: unknown }
  const list = Array.isArray(o.conversations) ? o.conversations : []
  const conversations: Conversation[] = []
  for (const item of list) {
    const c = item as Partial<Conversation>
    if (typeof c?.id !== 'string' || typeof c?.projectId !== 'string') continue
    conversations.push({
      id: c.id,
      projectId: c.projectId,
      title: typeof c.title === 'string' ? c.title : '',
      tool: typeof c.tool === 'string' ? c.tool : 'claude',
      agentSessionId: typeof c.agentSessionId === 'string' ? c.agentSessionId : null,
      cwd: typeof c.cwd === 'string' ? c.cwd : '',
      worktreePath: typeof c.worktreePath === 'string' ? c.worktreePath : null,
      branch: typeof c.branch === 'string' ? c.branch : null,
      lastActiveAt: typeof c.lastActiveAt === 'number' ? c.lastActiveAt : 0,
      createdAt: typeof c.createdAt === 'number' ? c.createdAt : 0,
      archivedAt: typeof c.archivedAt === 'number' ? c.archivedAt : null
    })
  }
  return { version: 1, conversations }
}

export interface ConversationUpsert {
  id: string
  projectId: string
  title: string
  tool: string
  cwd: string
  agentSessionId?: string | null
}

export interface ConversationsStore {
  list(): Conversation[]
  get(id: string): Conversation | undefined
  byProject(projectId: string): Conversation[]
  // Insert or update by id: on a fresh tab it inserts; a re-spawn patches the
  // mutable fields and bumps lastActiveAt without disturbing createdAt.
  upsert(c: ConversationUpsert): Conversation
  // Record the agent's resume id once known (claude at spawn, codex on discovery).
  // No-op if the conversation is gone (tab closed before discovery resolved).
  setAgentSessionId(id: string, agentSessionId: string): void
  setArchived(id: string, archived: boolean): void
  flush(): void
}

function crypto_randomUUID(): string {
  return (globalThis.crypto as { randomUUID(): string }).randomUUID()
}

export function createConversationsStore(deps?: {
  file?: string
  now?: () => number
}): ConversationsStore {
  const now = deps?.now ?? Date.now
  void crypto_randomUUID // ids arrive from callers (the tab's conversationId); kept for parity
  const store: JsonStore<ConversationsDoc> = createJsonStore({
    file: deps?.file ?? conversationsPath(),
    migrate: migrateConversations
  })

  return {
    list: () => store.get().conversations,
    get: (id) => store.get().conversations.find((c) => c.id === id),
    byProject: (projectId) => store.get().conversations.filter((c) => c.projectId === projectId),

    upsert(c) {
      const existing = store.get().conversations.find((x) => x.id === c.id)
      const t = now()
      if (existing) {
        store.mutate(() => {
          existing.title = c.title
          existing.tool = c.tool
          existing.cwd = c.cwd
          existing.projectId = c.projectId
          if (c.agentSessionId !== undefined) existing.agentSessionId = c.agentSessionId
          existing.lastActiveAt = t
          existing.archivedAt = null
        })
        return existing
      }
      const created: Conversation = {
        id: c.id,
        projectId: c.projectId,
        title: c.title,
        tool: c.tool,
        agentSessionId: c.agentSessionId ?? null,
        cwd: c.cwd,
        worktreePath: null,
        branch: null,
        lastActiveAt: t,
        createdAt: t,
        archivedAt: null
      }
      store.mutate((d) => d.conversations.push(created))
      return created
    },

    setAgentSessionId(id, agentSessionId) {
      const c = store.get().conversations.find((x) => x.id === id)
      if (!c) return
      store.mutate(() => {
        c.agentSessionId = agentSessionId
      })
    },

    setArchived(id, archived) {
      const c = store.get().conversations.find((x) => x.id === id)
      if (!c) return
      const t = now()
      store.mutate(() => {
        c.archivedAt = archived ? t : null
      })
    },

    flush: () => store.flush()
  }
}
