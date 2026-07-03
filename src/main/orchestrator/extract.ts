export interface Verdict {
  prompt: string | null
  reason?: string
}

// Find the index of the '}' closing the '{' at `start`, tracking JSON string and
// escape state so braces inside string values (or nested objects) don't end the
// scan early. Returns -1 when the object never closes.
function findBalancedEnd(s: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
    } else if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

// The classifier is told to reply with a flat {"prompt": ..., "reason": ...},
// but string values can legally contain braces and models sometimes add nested
// fields — so candidates are cut on balanced braces, not a no-inner-brace regex.
// This also finds objects sitting inside ```json fences or surrounding prose.
// Every candidate is JSON.parsed and kept only if it has a "prompt" key that is
// a string or null; the LAST valid one wins (models restate).
export function extractVerdict(output: string): Verdict | null {
  let last: Verdict | null = null
  for (let i = output.indexOf('{'); i !== -1; i = output.indexOf('{', i + 1)) {
    const end = findBalancedEnd(output, i)
    if (end === -1) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(output.slice(i, end + 1))
    } catch {
      // Not JSON from this brace (e.g. prose swallowing a real object) — retry
      // from the next '{', which may sit inside this failed candidate.
      continue
    }
    i = end // valid JSON: resume the scan after it
    if (!parsed || typeof parsed !== 'object') continue
    const obj = parsed as Record<string, unknown>
    if (!('prompt' in obj)) continue
    const prompt = obj.prompt
    if (typeof prompt !== 'string' && prompt !== null) continue
    last = { prompt, ...(typeof obj.reason === 'string' ? { reason: obj.reason } : {}) }
  }
  return last
}
