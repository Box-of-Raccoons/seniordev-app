// Renderer-side idle detection for S1. Idle is keyed on the RENDERED buffer, not
// the pty byte stream: the interactive TUIs repaint (cursor blink) every ~600ms,
// so the bytes never go quiet, but xterm collapses those repaints into a buffer
// whose text is stable. So we watch the buffer TEXT: it changing means working;
// it staying put for a beat means settled (then main scans it for a prompt).
// Pure and injectable, so both halves are testable without a real terminal.

// The minimal slice of xterm's IBuffer this needs. term.buffer.active satisfies
// it; a fake object does too, for tests.
export interface ScanBufferLine {
  translateToString(trimRight?: boolean): string
}
export interface ScanBuffer {
  readonly baseY: number
  getLine(y: number): ScanBufferLine | undefined
}

// Glyphs the CLI TUIs blink by toggling the CHARACTER to a space (not just its
// colour), which would otherwise keep the buffer from ever going stable while an
// agent sits at a prompt. Confirmed 2026-07-29: claude's tool-status bullet
// (⏺ U+23FA) toggles ⏺⇄space ~every 600ms. Extend as more are captured.
const BLINK_GLYPHS = /⏺/g

// Neutralize blinking glyphs for the STABILITY comparison only. The raw text is
// still what gets scanned for a prompt, so the menu (❯ 1. Yes) stays matchable;
// this just stops a lone blinking bullet from masking a settled screen.
export function normalizeForStability(text: string): string {
  return text.replace(BLINK_GLYPHS, ' ')
}

// Read `rows` lines starting at the viewport top (baseY) into newline-joined
// text — the last screenful, which is where a prompt sits (grounding 1.3).
export function readBufferText(buffer: ScanBuffer, rows: number): string {
  const out: string[] = []
  for (let i = 0; i < rows; i++) {
    const line = buffer.getLine(buffer.baseY + i)
    out.push(line ? line.translateToString(true) : '')
  }
  return out.join('\n')
}

// The buffer-stability state a tab carries between polls.
export interface IdleState {
  lastText: string
  lastChangeTs: number
  phase: 'active' | 'settled'
}

// What a poll decided to report to main this tick.
export type IdleEmit = 'active' | 'settled' | null

export function initialIdleState(now: number): IdleState {
  return { lastText: '', lastChangeTs: now, phase: 'active' }
}

// One poll step. Content changed → active (report only on the active edge, so a
// stream of changes isn't spammed). Content unchanged for `quietMs` while active
// → settled (report once). A repaint that renders the same text is "unchanged",
// so it never resets the timer — the whole point.
export function stepIdle(s: IdleState, text: string, now: number, quietMs: number): { state: IdleState; emit: IdleEmit } {
  if (text !== s.lastText) {
    const emit: IdleEmit = s.phase !== 'active' ? 'active' : null
    return { state: { lastText: text, lastChangeTs: now, phase: 'active' }, emit }
  }
  if (s.phase === 'active' && now - s.lastChangeTs >= quietMs) {
    return { state: { ...s, phase: 'settled' }, emit: 'settled' }
  }
  return { state: s, emit: null }
}
