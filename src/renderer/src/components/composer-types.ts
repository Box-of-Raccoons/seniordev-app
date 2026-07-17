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
}
