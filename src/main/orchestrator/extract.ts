export interface Verdict {
  prompt: string | null
  reason?: string
}

// The classifier's verdict object is flat — {"prompt": "...", "reason": "..."} —
// so a simple /\{[^{}]*\}/ scan (no nested braces) is sufficient; nested objects
// are out of scope. This scan also finds objects sitting inside ```json fences
// or surrounding prose. Every candidate is JSON.parsed and kept only if it has a
// "prompt" key that is a string or null; the LAST valid one wins (models restate).
export function extractVerdict(output: string): Verdict | null {
  let last: Verdict | null = null
  const braceRe = /\{[^{}]*\}/g
  for (let m = braceRe.exec(output); m; m = braceRe.exec(output)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(m[0])
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object') continue
    const obj = parsed as Record<string, unknown>
    if (!('prompt' in obj)) continue
    const prompt = obj.prompt
    if (typeof prompt !== 'string' && prompt !== null) continue
    last = { prompt, ...(typeof obj.reason === 'string' ? { reason: obj.reason } : {}) }
  }
  return last
}
