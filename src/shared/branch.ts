// Pure branch-name helpers, shared by the composer (renderer, for the editable
// branch prefill) and the worktree service (main, defense-in-depth sanitize).
// No node APIs, so the renderer can import them across the contextBridge boundary.

// A prompt/description turned into the variable part of a branch name: lowercase,
// non-alphanumeric runs collapsed to a single '-', trimmed, length-capped so a
// long ticket description doesn't produce an unwieldy branch. May be empty (an
// Open-mode launch has no prompt) — sanitizeBranchRef supplies the fallback.
export function slugifyForBranch(prompt: string, maxLen = 50): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug.slice(0, maxLen).replace(/-+$/g, '')
}

// Coerce an arbitrary string (branchPrefix + slug, possibly hand-edited) into a
// valid git branch ref, applying the rules `git check-ref-format` enforces:
// no whitespace or ~^:?*[\ or control chars, no '..', no '@{', internal '/'
// allowed but never leading/trailing/doubled, no leading/trailing '.' or '-', no
// trailing '.lock'. Empty after all of that falls back to 'task', so an empty
// branchPrefix (the default) still yields a valid, non-empty name.
export function sanitizeBranchRef(input: string): string {
  let s = input.toLowerCase().trim()
  s = s.replace(/@\{/g, '-') // '@{' is reserved (reflog syntax)
  s = s.replace(/[\s~^:?*[\]\\]+/g, '-') // whitespace + forbidden metacharacters
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\x00-\x1f\x7f]+/g, '-') // control characters
  s = s.replace(/\.{2,}/g, '.') // no consecutive dots ('..')
  s = s.replace(/\/{2,}/g, '/') // no doubled slashes
  s = s.replace(/-{2,}/g, '-') // tidy repeated separators
  s = s.replace(/\/\./g, '/').replace(/\.\//g, '/') // no component starting/ending with '.'
  s = s.replace(/^[-/.]+|[-/.]+$/g, '') // no leading/trailing '-', '/', '.'
  if (s.endsWith('.lock')) s = s.slice(0, -'.lock'.length).replace(/[-/.]+$/g, '')
  return s.length > 0 ? s : 'task'
}
