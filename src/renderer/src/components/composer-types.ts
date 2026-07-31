// The contract the inline composer emits on Launch, consumed by RightPanel to
// morph the tab into the right kind of session.
export interface ComposerLaunch {
  mode: 'interactive' | 'terminal'
  folder: string
  // interactive (agent) only:
  role?: string
  input?: string
  ticketKey?: string
  yolo?: boolean
  tool?: string
  // terminal only:
  shell?: string
  // S5 worktree (agent Task mode only). worktreePath is set only when a worktree
  // was created pre-flight; RightPanel makes it the cwdOverride and records it.
  // worktreeChoice is the checkbox state (checked or not), so the project can
  // remember the last choice even when it was off.
  worktreePath?: string
  branch?: string
  worktreeChoice?: boolean
}
