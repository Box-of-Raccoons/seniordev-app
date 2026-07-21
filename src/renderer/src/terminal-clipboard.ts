// Decide what a key event means for terminal clipboard, kept pure so the policy
// is testable without xterm or a DOM. The caller performs the actual clipboard IO
// and swallows/forwards the event based on the returned action.
//
//   Ctrl/Cmd+Shift+C → copy   (explicit, unambiguous)
//   Ctrl/Cmd+Shift+V → paste  (explicit)
//   Ctrl/Cmd+C       → copy only when text is selected; otherwise passthrough so
//                      the shell still receives SIGINT (standard terminal rule)
//   Ctrl/Cmd+V       → paste (text-only path bypasses the OS image-paste that
//                      makes Codex error "can't paste image")
//   anything else    → passthrough to the pty
export type ClipboardAction = 'copy' | 'paste' | 'passthrough'

export interface KeyLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

export function clipboardAction(e: KeyLike, hasSelection: boolean): ClipboardAction {
  const mod = e.ctrlKey || e.metaKey
  if (!mod) return 'passthrough'
  const k = e.key.toLowerCase()
  // Copy is gated on a selection in both plain and Shift forms: a bare Ctrl+C
  // with nothing selected must still interrupt the running command.
  if (k === 'c') return hasSelection ? 'copy' : 'passthrough'
  if (k === 'v') return 'paste'
  return 'passthrough'
}
