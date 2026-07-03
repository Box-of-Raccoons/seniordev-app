# SeniorDev

A cross-platform desktop workbench: a tabbed Jira ticket reader (left) and a tabbed interactive CLI-agent terminal multiplexer (right). Read a ticket, spin up a Claude Code / Codex session in the mapped repo, or "YOLO" a prebuilt prompt that runs the agent headless and ends in a PR.

## Configure

Copy `config.example.yaml` to your OS config dir and fill it in:

- Windows: `%APPDATA%\SeniorDev\config.yaml`
- macOS/Linux: `~/.config/SeniorDev/config.yaml`

Override the config path with the `SENIORDEV_CONFIG` environment variable.

Prompts default to a `prompts/` folder next to `config.yaml` (same dir), overridable via the `promptsDir` config key. One markdown file per prompt with `name`/`description` frontmatter and `{{ticket.*}}` / `{{forge.*}}` placeholders, including `{{ticket.context}}` — a reusable context block maintained in `_ticket-context.md` in the same dir.

### YOLO config

YOLO runs are headless — the CLI agent runs as a plain child process (no PTY) with its autonomous/print-mode flags. Both `claude` and `codex` presets ship out of the box; the `headless` block is what enables YOLO for a tool.

```yaml
defaultTool: claude
cliTools:
  claude:
    command: claude
    interactiveArgs: []
    promptDelivery: stdin
    headless:
      args: [-p, --output-format, stream-json, --verbose, --permission-mode, auto]
      outputParser: claude-stream-json   # claude-stream-json | codex-jsonl | text
      # sessionIdPattern: '...'          # optional regex fallback, parser: text only
    resumeArgs: [--resume, '{{sessionId}}']
  codex:
    command: codex
    headless:
      args: [exec, --json, --dangerously-bypass-approvals-and-sandbox, '-']
      outputParser: codex-jsonl
    resumeArgs: [resume, '{{sessionId}}']

# yoloRecap is appended to every YOLO prompt. Empty string disables.
# Built-in default (from presets.ts) shown here; config value overrides it.
yoloRecap: |
  When you are completely finished, end your final message with:
  1. "## Changes made" — every file you changed and a one-line why.
  2. "## Pull requests" — the URL of each PR/MR you created
     (one per project if this repo is a monorepo).
```

- **`headless.args`** — full flag set passed to the CLI for an autonomous run. The prompt is always sent over stdin (written then closed); never an argv element.
- **`headless.outputParser`** — selects the built-in stream parser. `claude-stream-json` and `codex-jsonl` extract structured events; `text` passes lines through (use with `sessionIdPattern` for resume support on other tools).
- **`resumeArgs`** — template appended to `interactiveArgs` when the Resume button spawns a follow-up tab. `{{sessionId}}` is substituted. Omit to disable the Resume button for a tool.
- **`yoloRecap`** — appended (with a blank line) to every YOLO prompt so the agent ends its run with a structured summary. Set an empty string to disable entirely.
- **`yoloArgs`** — no longer used. Old configs containing this key load without error; the key is silently ignored.

## In-app configuration

The menu bar shows **File / Edit / Config / About**.

**Config → App Config** opens `config.yaml` in a built-in editor with schema validation. Saving applies the new config immediately — sessions opened after saving use the updated values; sessions already running are untouched. A save is rejected (precise error, file unchanged) if the YAML is invalid or fails schema validation.

**Config → Prompt Config** manages the prompts directory. From here you can:
- Edit the ticket-context template (`_ticket-context.md` in the prompts dir) — its content is what `{{ticket.context}}` expands to in any prompt.
- Edit the YOLO recap text (the instruction appended to every YOLO prompt asking the agent to end with a structured summary).
- Create, edit, or delete prebuilt prompts; changes appear in the YOLO / New Session menu immediately, no restart required.

**File → New Session** (`Ctrl+N`) resets the workbench: all open tickets and terminal sessions are closed and the layout returns to its initial state. If any sessions are running you are asked to confirm first.

**About** shows the application name, version, and credits.

## YOLO

Selecting a prompt from the YOLO menu (or running `seniordev PROJ-123 --yolo fix-bug`) opens a dedicated YOLO tab — no PTY, no TUI:

1. **Live log** — the agent's stdout/stderr streams through the configured parser and renders as a scrolling monospace log, using the same font as the interactive terminals. Tool calls appear as one-liners (e.g. `▸ Edit src/foo.ts`).

2. **PR cards** — every PR/MR URL detected anywhere in the output is surfaced as a card with an Open button. Monorepo runs that open several PRs produce several cards, in order.

3. **Recap** — the built-in `yoloRecap` instruction appended to each prompt asks the agent to end with `## Changes made` and `## Pull requests` sections, so the structured summary is always the last visible output.

4. **Stop button** — while the run is live, a **Stop** button at the bottom of the tab tree-kills the session (the agent and any git/gh processes it spawned) but keeps the tab open — log, PR cards, and the resume path all survive. Closing the tab also kills the session, but discards the log with it.

5. **Resume button** — after the run exits (finished, failed, or stopped), a **"Resume YOLO Session?"** button appears at the bottom of the tab if a session id was captured. Clicking it opens a new interactive terminal tab in the same repo cwd running `claude --resume <id>` (or `codex resume <id>`), so you can inspect diffs, answer follow-up questions, or iterate on the result without starting over. The YOLO tab stays open with the full log and PR links.

## Develop

```bash
pnpm install
pnpm dev          # launch the app (electron-vite)
pnpm test         # vitest
pnpm typecheck
```

> node-pty is native; on first run electron-builder/electron-rebuild aligns it to the Electron ABI.

## Command line

```
seniordev [tickets...] [--interactive] [--yolo <prompt>] [--prompt <text|@file>] [--tool <name>]
```

- `seniordev PROJ-123 PROJ-124` — open both tickets.
- `seniordev PROJ-123 --yolo fix-bug` — open the ticket and run the `fix-bug` prompt headless; a live log tab opens, PR cards surface on completion.
- `--tool codex` — override the default CLI tool.

## Package

```bash
pnpm dist         # installers into release/ (per-OS: NSIS / dmg / AppImage)
pnpm dist:dir     # unpacked app dir
```
