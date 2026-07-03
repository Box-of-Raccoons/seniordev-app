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

# yoloPreamble is prepended to every YOLO prompt. Empty string disables.
# Built-in default (from presets.ts) shown here; config value overrides it.
yoloPreamble: |
  This is a headless, autonomous session — no human is watching to answer
  questions. Work the task to completion to the best of your ability. When you
  hit ambiguity, make the most reasonable assumption, note it in your final
  recap, and keep going. Do not stop to ask for confirmation or clarification;
  stop only when the task is done or you are genuinely blocked.

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
- **`yoloPreamble`** — prepended (with a blank line) to every YOLO prompt so the agent knows it is running headless and autonomous and shouldn't pause to ask questions. Set an empty string to disable entirely.
- **`yoloRecap`** — appended (with a blank line) to every YOLO prompt so the agent ends its run with a structured summary. Set an empty string to disable entirely.
- **`yoloArgs`** — no longer used. Old configs containing this key load without error; the key is silently ignored.

## Prompt library

A fresh install seeds a set of role-based prompts into `promptsDir` on first launch (from the copies committed under `resources/prompts/`, bundled into the installer). Seeding is non-destructive — it only fills in files you don't already have, so your edits and deletions are never clobbered. Each covers one SDLC role against a Jira ticket:

| Prompt | Role | What it does |
| --- | --- | --- |
| `business-analyst` | BA | Breaks the source documentation on a ticket into a Jira epic + child stories with acceptance criteria. |
| `tech-lead` | Architect | Produces a short technical design and a suggested story breakdown before implementation. |
| `developer` | Senior dev | Pulls the ticket, works on a feature branch, implements, adds + runs tests, commits, and opens a PR. |
| `qa` | QA | Derives a test plan from the acceptance criteria, writes Playwright e2e + unit tests, runs them, reports pass/fail per criterion. |
| `code-reviewer` | Reviewer | Reviews the open PR / working changes against the ticket's acceptance criteria — reviews, doesn't implement. |
| `doc-writer` | Docs | Updates the user/dev docs to match the behavior a ticket changes. |

Manage them from **Config → Prompt Config** (create, edit, delete). Prompt bodies may use only these template variables — anything else renders literally to the agent:

| Variable | Expands to |
| --- | --- |
| `{{ticket.key}}` | Issue key, e.g. `PROJ-123` |
| `{{ticket.type}}` | Issue type, e.g. `Story` |
| `{{ticket.status}}` | Workflow status, e.g. `To Do` |
| `{{ticket.summary}}` | Issue summary / title |
| `{{ticket.description}}` | Description, rendered to Markdown |
| `{{ticket.acceptanceCriteria}}` | Acceptance-criteria field |
| `{{ticket.comments}}` | Comments, rendered to Markdown |
| `{{forge.term}}` | Forge's term for a change request, e.g. `PR` / `MR` |
| `{{forge.prCommand}}` | Configured PR-open command, resolved per repo |
| `{{ticket.context}}` | The reusable ticket-context block (`_ticket-context.md`) |

## In-app configuration

The menu bar shows **File / Edit / Config / About**.

**Config → App Config** opens `config.yaml` in a built-in editor with schema validation. Saving applies the new config immediately — sessions opened after saving use the updated values; sessions already running are untouched. A save is rejected (precise error, file unchanged) if the YAML is invalid or fails schema validation.

**Config → Prompt Config** manages the prompts directory. From here you can:
- Edit the ticket-context template (`_ticket-context.md` in the prompts dir) — its content is what `{{ticket.context}}` expands to in any prompt.
- Edit the YOLO preamble text (the autonomy instruction prepended to every YOLO prompt telling the agent it's running headless and shouldn't pause to ask questions).
- Edit the YOLO recap text (the instruction appended to every YOLO prompt asking the agent to end with a structured summary).
- Create, edit, or delete prebuilt prompts; changes appear in the YOLO / New Session menu immediately, no restart required.

**File → New Session** (`Ctrl+N`) resets the workbench: all open tickets and terminal sessions are closed and the layout returns to its initial state. If any sessions are running you are asked to confirm first.

**About** shows the application name, version, and credits.

## YOLO

Selecting a prompt from the YOLO menu (or running `seniordev PROJ-123 --yolo developer`) opens a dedicated YOLO tab — no PTY, no TUI:

1. **Live log** — the agent's stdout/stderr streams through the configured parser and renders as a scrolling monospace log, using the same font as the interactive terminals. Tool calls appear as one-liners (e.g. `▸ Edit src/foo.ts`).

2. **PR cards** — every PR/MR URL detected anywhere in the output is surfaced as a card with an Open button. Monorepo runs that open several PRs produce several cards, in order.

3. **Recap** — the built-in `yoloRecap` instruction appended to each prompt asks the agent to end with `## Changes made` and `## Pull requests` sections, so the structured summary is always the last visible output.

4. **Stop button** — while the run is live, a **Stop** button at the bottom of the tab tree-kills the session (the agent and any git/gh processes it spawned) but keeps the tab open — log, PR cards, and the resume path all survive. Closing the tab also kills the session, but discards the log with it.

5. **Resume button** — after the run exits (finished, failed, or stopped), a **"Resume YOLO Session?"** button appears at the bottom of the tab if a session id was captured. Clicking it opens a new interactive terminal tab in the same repo cwd running `claude --resume <id>` (or `codex resume <id>`), so you can inspect diffs, answer follow-up questions, or iterate on the result without starting over. The YOLO tab stays open with the full log and PR links.

## Trigger from Jira (bookmarklet)

One click from a Jira issue launches SeniorDev via the `seniordev://` deep-link protocol. Two URL forms exist: `seniordev://open?ticket=SD-6` loads the ticket with no prompt, while `seniordev://yolo?ticket=SD-6` loads the ticket and shows an in-app confirmation before running the Jira Orchestrator. The first protocol click in your browser shows the one-time OS prompt **Open SeniorDev? ☑ Always allow**; tick "always allow" to skip re-prompting.

**YOLO trigger.** Create a bookmark with this as the URL:

```javascript
javascript:(function(){var m=location.href.match(/\/browse\/([A-Za-z][A-Za-z0-9]*-\d+)/)||location.search.match(/selectedIssue=([A-Za-z][A-Za-z0-9]*-\d+)/);if(m){location.href='seniordev://yolo?ticket='+m[1]}else{alert('No Jira issue key found in this URL')}})();
```

**Open only.** Create a bookmark with this as the URL:

```javascript
javascript:(function(){var m=location.href.match(/\/browse\/([A-Za-z][A-Za-z0-9]*-\d+)/)||location.search.match(/selectedIssue=([A-Za-z][A-Za-z0-9]*-\d+)/);if(m){location.href='seniordev://open?ticket='+m[1]}else{alert('No Jira issue key found in this URL')}})();
```

Both work on issue detail pages (`/browse/KEY`) and board/backlog views (`?selectedIssue=KEY`).

### Jira Orchestrator

A confirm gate appears before any deep-link YOLO run — any webpage can navigate to `seniordev://yolo`, so the app always asks first. Confirming runs the orchestrator in two stages: **classify** reads your ticket and prompt library, outputs a JSON object naming the best playbook, then **spawn** launches that prompt verbatim as a normal YOLO run (tab title shows `Jira Orchestrator → <name>`). If the classifier fails — exits non-zero, returns malformed output, names a nonexistent prompt, or answers null — no stage 2 runs; the tab shows the classifier log and reason instead. Never guess-and-run.

Customize the routing prompt via **Config → Prompt Config** → **Jira Orchestrator**. Saving writes `_jira-orchestrator.md` in your prompts directory (underscore-prefixed, so it never shows up as a launchable playbook); saving text identical to the built-in deletes the override and reverts to the default. The built-in cannot be deleted. Read-only behavior during classification is prompt-enforced — the classifier runs with the tool's normal headless flags and is only instructed not to modify files.

## SeniorDevWatch (background tray poller)

SeniorDevWatch is a separate, headless system-tray process that watches Jira for your `SeniorDev`-labeled work and drives each new ticket through the Jira Orchestrator (classify → spawn) without you opening the app. On each tick it runs the query:

```
assignee = currentUser() AND labels = SeniorDev AND statusCategory = "To Do"
```

and dispatches any ticket it hasn't seen before, one at a time (a sequential queue — never two runs at once). The label, status category, and poll interval are configurable under the `watch` block in `config.yaml` (see `config.example.yaml`); watch is disabled unless you set `watch.enabled: true`.

### Run it

```bash
pnpm watch
```

This builds and launches the tray process. It has no window — it lives entirely in the system tray (a sleeping-raccoon icon when idle, a hard-hat raccoon while a run is in flight). It reads the same `config.yaml` as the main app and keeps its own dedup/runtime state in `watch-state.json` next to your config.

### Tray menu

Right-click the tray icon:

- **Auto-dispatch** — a checkbox toggling between auto and approve-first mode (see below). The choice persists to `watch-state.json` and overrides the `watch.autoMode` config default at runtime.
- **Pause polling / Resume polling** — stop or restart the poll timer without quitting.
- **Poll now** — poll Jira immediately instead of waiting for the next interval.
- **Open config** — open `config.yaml` in your default editor.
- **Quit** — kill any in-flight runs and exit.

### Auto vs. approve

- **Auto-dispatch on** — a newly matched ticket is classified and run immediately.
- **Auto-dispatch off (approve-first)** — a newly matched ticket raises a click-to-run notification instead; nothing runs until you click it to approve. This is the default.

Either way, when a run is committed the ticket is transitioned to `In Progress` (configurable via `watch.transitionOnDispatch`) and recorded in `watch-state.json`, so it leaves the query and is never re-dispatched. If the transition itself fails, the run still proceeds and you get a notification about the transition error.

### Edge cases

- **No matching repo** — a ticket whose project key has no entry in `repos` is skipped with a "no repo configured" notification. It is never run in the wrong place.
- **Failed classification** — if the classifier can't route a ticket (non-zero exit, malformed output, an unknown or null playbook), the failure is recorded in `watch-state.json` so the ticket isn't re-classified every tick. To retry it, remove that ticket's key from `watch-state.json` (and fix whatever caused the failure).
- **Long-running / hung runs** — runs are sequential, so one stuck classify or run would otherwise block the queue. Set `watch.runWarnSeconds` (0 = off) and, when a phase exceeds it, you get a notification you can click to kill that run — freeing the queue. The killed run reports as a normal failure/non-zero exit.

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
- `seniordev PROJ-123 --yolo developer` — open the ticket and run the `developer` prompt headless; a live log tab opens, PR cards surface on completion.
- `--tool codex` — override the default CLI tool.

## Package

```bash
pnpm dist         # installers into release/ (per-OS: NSIS / dmg / AppImage)
pnpm dist:dir     # unpacked app dir
```
