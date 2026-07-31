import { execFileSync } from 'node:child_process'

// A macOS/Linux app launched from the GUI (Finder/Dock) does NOT inherit the
// user's shell PATH — launchd hands it a minimal /usr/bin:/bin:/usr/sbin:/sbin.
// So a CLI tool installed under ~/.local/bin, /opt/homebrew/bin, a node version
// manager, etc. is invisible: node-pty can't spawn `claude`/`codex` and the
// terminal shows "[process exited: 1]". We recover the real PATH by asking the
// user's login+interactive shell for it (it sources the same rc files a real
// terminal does) and merging it into process.env.PATH. Windows GUI apps inherit
// PATH normally, so this is a no-op there.

const START = '__SD_PATH_START__'
const END = '__SD_PATH_END__'

export type Exec = (shell: string, args: string[]) => string

// Ask the login shell for its PATH. `-ilc` (interactive + login) sources
// .zprofile/.zshrc / .bash_profile where PATH additions live. The delimiters
// fence off any banner/motd the interactive shell prints. Returns undefined on
// any failure — a broken probe must never break app startup.
export function queryLoginPath(shell: string, exec: Exec): string | undefined {
  try {
    const out = exec(shell, ['-ilc', `printf '${START}%s${END}' "$PATH"`])
    const m = out.match(new RegExp(`${START}([\\s\\S]*)${END}`))
    const path = m?.[1]?.trim()
    return path && path.length > 0 ? path : undefined
  } catch {
    return undefined
  }
}

// Merge the login PATH into the current one: login entries first (they hold the
// user's real toolchain), then any current entry not already present. Deduped,
// order-preserving, empty segments dropped.
export function mergePath(current: string, login: string, sep = ':'): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of [...login.split(sep), ...current.split(sep)]) {
    if (p !== '' && !seen.has(p)) {
      seen.add(p)
      out.push(p)
    }
  }
  return out.join(sep)
}

export interface FixPathDeps {
  platform: NodeJS.Platform
  env: { PATH?: string; SHELL?: string }
  exec: Exec
}

// Compute the corrected PATH for a GUI-launched app. No-op (undefined) on win32
// and whenever the probe fails. Pure: does not mutate env — the caller assigns
// the result, which keeps the effect testable.
export function fixedPath(deps: FixPathDeps): string | undefined {
  if (deps.platform === 'win32') return undefined
  const shell = deps.env.SHELL || (deps.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  const login = queryLoginPath(shell, deps.exec)
  if (!login) return undefined
  return mergePath(deps.env.PATH ?? '', login)
}

// Wiring for src/main/index.ts: probe the real login shell and, if it yields a
// PATH, apply it to process.env so every later node-pty spawn can find the user's
// CLI tools. Synchronous and one-time at startup; the 5s timeout bounds a hung
// shell rc. Silent no-op on failure.
export function applyFixedPath(): string | undefined {
  const next = fixedPath({
    platform: process.platform,
    env: process.env,
    exec: (shell, args) => execFileSync(shell, args, { encoding: 'utf8', timeout: 5000 })
  })
  if (next) process.env.PATH = next
  return next
}
