// One source of truth for the console visuals — the xterm terminal
// (TerminalView), the YOLO log (YoloView), and the orchestrator log
// (OrchestratorView) must never drift apart. TERM_BG is a raw hex (not a CSS
// token) because xterm's theme is configured in JS, not CSS.
export const TERM_FONT_FAMILY = 'Consolas, monospace'
export const TERM_FONT_SIZE = 13
export const TERM_BG = '#1a1f1d'
