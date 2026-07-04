# SeniorDev — Design

**Date:** 2026-07-02
**Status:** Approved (brainstorming) — pending spec review
**Repo:** `C:\Users\hardy\code\seniordev-app` (new; genesis on `develop`)

> Note: the older `C:\Users\hardy\code\seniordev` repo (the Claude Code *plugin*) is
> retired but retained for salvage (Jira field knowledge, YOLO prompt content,
> config-schema ideas). This project reuses the **name** and the **concept**
> (take a Jira ticket → implement → open a PR), not the plugin runtime.

## One-liner

A cross-platform Electron desktop app — a two-panel "ticket workbench" — with a
tabbed Jira-ticket reader on the left and a tabbed, multiplexed interactive-CLI
terminal on the right, wired together by a ticket→repo mapping and reusable
prebuilt prompts. Sessions run either **Interactive** (you drive) or **YOLO**
(auto-send a prebuilt prompt, bypass permissions, watch it work, surface the PR).

## Goals

- Read Jira tickets rendered from native ADF, one or several at a time (tabs).
- Run one or more interactive CLI-agent sessions (Claude Code, Codex, …) in a
  terminal multiplexer, each in the correct repo working directory.
- Kick off autonomous "YOLO" runs from prebuilt prompts that end in a PR/MR.
- Be tool-agnostic (any CLI) and forge-agnostic (GitHub/GitLab/…): both defined
  in config, no code change to add one.
- Launch from the command line with tickets and a starting mode/prompt.

## Non-goals (YAGNI)

- The app does **not** run git itself. Branch/commit/PR creation is done by the
  CLI agent (the prompt calls `gh`/`glab`). The app only resolves the cwd,
  optionally names a branch for the agent, and scrapes the resulting PR URL.
- No first-party Bitbucket preset shipped (no reliable official CLI); structure
  supports it as a user-fillable stub.
- No OAuth for Jira in v1 — API token only (Jira Cloud).
- No in-app settings editor in early phases; the YAML config file is authoritative.

## Decisions (locked during brainstorming)

| Fork | Decision | Why |
|---|---|---|
| Framework | **Electron + xterm.js + node-pty** | Real interactive PTY is the crux; node-pty is the proven cross-platform path (esp. Windows ConPTY) that xterm.js/VS Code use. Tauri's Rust-sidecar PTY is more DIY for this exact use case. |
| Jira | **Cloud REST API v3 + API token** | Simplest; no OAuth dance. Standalone app needs its own connection (can't borrow Claude's Atlassian MCP). |
| Session ↔ repo | **Ticket→repo mapping in config, per-terminal override** | Automation for YOLO/PR; manual escape hatch when needed. |
| YOLO execution | **Visible auto-run terminal** (bypass permissions, auto-send prompt) | Transparent — watch live, jump in. Prompt does `gh pr create`; app scrapes URL. |
| Ticket → prompt | **Config toggle `ticketContext: inject \| key-only \| both`, default `both`** | Tool-agnostic + deterministic by default; key always present so a Jira-capable CLI can fetch more. |
| CLI tool config | **Generic command-template registry** (`cliTools{}`) | Add any future CLI by editing config; ships claude + codex presets. |
| Forge config | **Generic `forges{}` registry** | Add GitHub/GitLab/… by config; ships github + gitlab presets, bitbucket stub. |

## Architecture

### Process model
- **Main process (Node):** privileged/native work — spawns PTYs via `node-pty`,
  holds the Jira REST client + API token (token never enters the renderer),
  reads/validates config, resolves ticket→repo, watches terminal streams for PR
  URLs. Exposes a narrow, typed IPC surface.
- **Renderer (Vue 3 + Vite):** the two-panel UI. Left = ADF ticket tabs; right =
  xterm.js terminal tabs. No secrets, no direct process spawning.
- **Preload bridge:** `contextBridge` exposing only whitelisted IPC
  (`jira.getTicket`, `pty.spawn/write/resize/kill`, `session.startInteractive`,
  `session.startYolo`, `config.get`, `prompts.list`).

### Components (each independently testable)

1. **`config`** — loads/validates YAML (Zod). One source of truth: Jira creds,
   `repos[]`, `cliTools{}`, `defaultTool`, `forges{}`, `defaultForge`,
   `ticketContext`, `promptsDir`.
2. **`jira-client`** (main) — REST v3: fetch issue by key → normalized `Ticket`
   (key, type, status, summary, description-ADF, acceptanceCriteria, comments).
   Pure data; no UI.
3. **`adf-renderer`** (renderer) — ADF → HTML (left panel) and ADF → markdown
   (prompt injection). One parser, two outputs.
4. **`terminal-manager`** (main) — PTY lifecycle: spawn in a resolved cwd,
   stream data ↔ renderer, resize, kill. One PTY per right-panel tab.
5. **`session-orchestrator`** (main) — the glue: resolve ticket→repo (+ optional
   branch), pick CLI tool from registry, build the launch (interactive vs yolo
   args), deliver the prompt (stdin-paste or arg), and in yolo mode scan the
   stream for a PR/MR URL → emit `pr-ready`.
6. **`prompt-library`** — loads prompt templates from `promptsDir`; expands
   `{{ticket.*}}` / `{{forge.*}}` placeholders per the `ticketContext` toggle.
7. **`ui-shell`** (renderer) — two-panel layout; left ticket tabs (+ key input &
   Open button); right terminal tabs (+ "New session" menu: Interactive /
   YOLO→pick-prompt / New-prompt).

### Data flow — open a ticket and work it

```
User types PROJ-123 + Open
  └─ renderer → IPC jira.getTicket("PROJ-123")
       └─ main: jira-client fetches → normalized Ticket → renderer
            └─ left panel: adf-renderer renders a ticket tab

User: New session → YOLO → "fix-bug" on PROJ-123
  └─ renderer → IPC session.startYolo{ ticket, prompt:"fix-bug", tool:"claude" }
       └─ session-orchestrator:
            resolve repo path + branch (config.repos, override allowed)
            resolve forge (repo.forge ?? defaultForge)
            expand prompt via prompt-library (inject ticket ctx per toggle,
                                              {{forge.prCommand}}/{{forge.term}})
            terminal-manager.spawn(cliTool.command, cliTool.yoloArgs, cwd=repo)
            deliver prompt (stdin paste)  ──▶ xterm.js tab shows it live
            watch stream → match any forge urlPattern → emit "pr-ready"
                          → renderer shows "✅ {{term}} ready [Open]" card
```

## Config file (YAML)

Standard per-user path: `%APPDATA%/SeniorDev/config.yaml` (Windows),
`~/.config/SeniorDev/config.yaml` (else). Zod-validated on load; authoritative.

```yaml
jira:
  baseUrl: https://yoursite.atlassian.net
  email: you@company.com
  apiToken: <token>            # from id.atlassian.com

ticketContext: both            # inject | key-only | both  (default: both)

defaultTool: claude
cliTools:
  claude:
    command: claude
    interactiveArgs: []
    yoloArgs: [--permission-mode, bypassPermissions]
    promptDelivery: stdin      # type prompt into the PTY
    modelArgs: [--model, "{{model}}"]   # how this tool expresses a model on argv
    defaultModel: claude-sonnet-4-5     # optional; used when a prompt omits `model:`
  codex:
    command: codex
    yoloArgs: [--yolo]
    promptDelivery: arg
    promptArg: "{{prompt}}"
    modelArgs: [--model, "{{model}}"]

defaultForge: github
forges:
  github:
    prCommand: gh pr create
    term: PR
    urlPattern: 'https://github\.com/[^/]+/[^/]+/pull/\d+'
  gitlab:
    prCommand: glab mr create
    term: MR
    urlPattern: 'https://gitlab\.com/.+/-/merge_requests/\d+'
  bitbucket:                   # stub — no reliable first-party CLI; fill per team
    prCommand: ''
    term: PR
    urlPattern: 'https://bitbucket\.org/[^/]+/[^/]+/pull-requests/\d+'

repos:
  - key: PROJ                  # Jira project key (prefix match on ticket)
    path: C:/Users/hardy/code/backend
    branchPrefix: feature/     # yolo branch hint = feature/PROJ-123
    forge: github              # optional; falls back to defaultForge

promptsDir: C:/Users/hardy/.config/SeniorDev/prompts   # default; overridable
```

## Prebuilt prompts

One markdown file per prompt in `promptsDir`, with tiny frontmatter. Reusable in
both interactive and yolo modes.

```markdown
---
name: fix-bug
description: Implement a bug ticket, test, open a PR
model: claude-opus-4-1        # optional; the model this prompt should run on
---
Work Jira ticket {{ticket.key}}: "{{ticket.summary}}"

{{ticket.description}}

Acceptance criteria:
{{ticket.acceptanceCriteria}}

Implement the fix, add tests, run the suite, then open a
{{forge.term}} with `{{forge.prCommand}}`.
```

The optional `model:` frontmatter key picks the model this prompt runs on.
Resolution order (highest wins): the prompt's `model` → the tool's `defaultModel`
→ nothing (the CLI's own default). The resolved model is substituted into the
tool's `modelArgs` and appended to argv on **both** the interactive and
headless/YOLO launch paths; with neither set, argv is unchanged. No allowlist —
an unknown/incompatible model is left for the CLI to reject.

Placeholders: `{{ticket.key|summary|description|acceptanceCriteria|comments|type|status}}`,
`{{forge.prCommand|term}}`. `ticketContext` mode governs `{{ticket.*}}` expansion:
`inject`/`both` fill all fields; `key-only` fills just `{{ticket.key}}` and
collapses the rest. `{{ticket.key}}` is always present. A **"New prompt"** session
skips the library — you type/paste an ad-hoc first prompt (works in both modes).

## Command-line launch args

```
seniordev [tickets...] [--interactive] [--yolo <prompt-name>]
          [--prompt <text|@file>] [--tool <name>]
```

- `seniordev PROJ-123 PROJ-124` → open both as left-panel tabs at startup.
- `--interactive` (default) → plain interactive session for the ticket(s).
- `--yolo fix-bug` → autonomous run of the `fix-bug` prompt.
- `--prompt "..."` / `--prompt @path.md` → ad-hoc first prompt (interactive or yolo).
- `--tool codex` → override `defaultTool` for this launch.

## PR/MR detection

`session-orchestrator` runs the terminal stream through the configured forges'
`urlPattern`s. It matches against **all** configured patterns (so detection is
robust even if the repo→forge mapping is imperfect); the "ready" label uses the
matched forge's `term`. First match in a yolo session → `pr-ready` event → the
renderer shows a "✅ {{term}} ready [Open]" card on that tab. Deliberately a
heuristic on output — the app doesn't run git; the prompt's `gh`/`glab` does.

## Phasing (build order — usable core first)

1. **Skeleton + read paths** — Electron shell, two-panel layout, config
   load/validate, `jira-client`, ADF→HTML, ticket tabs + key input. *No terminal.*
   Outcome: open and read tickets.
2. **Interactive terminals** — `terminal-manager` + xterm.js tabs, spawn CLI in
   resolved cwd, multiple tabs. Outcome: the multiplexer + interactive sessions work.
3. **Prompts + injection** — `prompt-library`, ADF→markdown, ticket→prompt
   expansion, "New session" menu, ad-hoc prompts.
4. **YOLO + PR detection** — yolo launch (bypass flags), auto-send prompt,
   stream-scan, PR/MR card.
5. **CLI launch args + polish** — startup arg parsing, packaging via
   `electron-builder` (Win/Mac/Linux installers).

## Testing

- **Unit (vitest):** `config` validation (good/bad YAML); `jira-client`
  normalization (fixture ADF → `Ticket`); `adf-renderer` (ADF nodes → HTML &
  markdown incl. tables/panels/code); `prompt-library` expansion per toggle mode;
  forge PR-URL matching; ticket→repo resolution + branch naming.
- **Integration:** `terminal-manager` spawns a real short-lived process
  (e.g. `node -e`), asserts data round-trips and resize works — proves the PTY
  path without needing the real `claude` binary in CI.
- **Manual (user-only, cannot be mocked):** real `claude`/`codex` interactive
  feel; a real yolo run producing a real PR; cross-OS packaging. Flagged as the
  user's verification steps.

## Open items (non-blocking)

- Renderer UI framework confirmed as **Vue 3 + Vite** (matches the user's other
  frontends); revisit only if a reason surfaces.
- Bitbucket `prCommand` mechanism to be finalized when a real Bitbucket repo is
  in front of us.
