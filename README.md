# SeniorDev

A cross-platform desktop multiplexer for driving CLI coding agents. One region of
tabs, where each tab is a session you launched. Open the composer, pick how to work
(an interactive Claude session, a raw terminal, or a role-based prompt that runs
headless and ends in a PR), point it at a folder, and give it a Jira ticket key or
a sentence of intent.

SeniorDev does not read Jira itself. Given a ticket key, it hands that key to the
agent, which reads the issue through its own Atlassian MCP, so the app holds no
Jira credentials and never renders the ticket.

## The composer

Click **+** and pick what to open: an agent tool (**Claude** now, **Codex** once
it is on your PATH) or a raw **Terminal**. Your choice opens a composer as a new tab:

- **Folder**: the working directory for the session. A ticket key whose project
  prefix matches a `repos` entry prefills this for you.
- **Role** (agent only): the prompt to run, drawn from the prompt library
  (default `orchestrator`).
- **Ticket or description** (agent only): a single smart field that takes either a
  Jira ticket key (e.g. `PROJ-123`) or a free-text description of the work.
  Cmd/Ctrl+Enter launches.
- **YOLO** (agent only): a checkbox that flips the run to auto-execute headless and
  open a PR at the end.
- **Shell** (Terminal only): pwsh, cmd, bash, or wsl.

On Launch the composer tab morphs in place into the live agent terminal (or, for
Terminal, the raw shell).

## Configure

Copy `config.example.yaml` to your OS config dir and fill it in:

- Windows: `%APPDATA%\SeniorDev\config.yaml`
- macOS/Linux: `~/.config/SeniorDev/config.yaml`

Override the config path with the `SENIORDEV_CONFIG` environment variable. No Jira
credentials are required: SeniorDev passes the ticket key to the agent, which reads
the issue through its own Atlassian MCP.

Prompts default to a `prompts/` folder next to `config.yaml` (same dir), overridable
via the `promptsDir` config key. One markdown file per prompt, with `name`/`description`
frontmatter and `{{ticket.key}}` / `{{forge.*}}` placeholders.

### YOLO config

YOLO runs are headless: the CLI agent runs as a plain child process (no PTY) with
its autonomous/print-mode flags. Both `claude` and `codex` presets ship out of the
box; the `headless` block is what enables YOLO for a tool.

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
  This is a headless, autonomous session with no human watching to answer
  questions. Work the task to completion to the best of your ability. When you
  hit ambiguity, make the most reasonable assumption, note it in your final
  recap, and keep going. Do not stop to ask for confirmation or clarification;
  stop only when the task is done or you are genuinely blocked.

# yoloRecap is appended to every YOLO prompt. Empty string disables.
# Built-in default (from presets.ts) shown here; config value overrides it.
yoloRecap: |
  When you are completely finished, end your final message with:
  1. "## Changes made": every file you changed and a one-line why.
  2. "## Pull requests": the URL of each PR/MR you created
     (one per project if this repo is a monorepo).
```

- **`headless.args`**: full flag set passed to the CLI for an autonomous run. The prompt is always sent over stdin (written then closed); never an argv element.
- **`headless.outputParser`**: selects the built-in stream parser. `claude-stream-json` and `codex-jsonl` extract structured events; `text` passes lines through (use with `sessionIdPattern` for resume support on other tools).
- **`resumeArgs`**: template appended to `interactiveArgs` when the Resume button spawns a follow-up tab. `{{sessionId}}` is substituted. Omit to disable the Resume button for a tool.
- **`yoloPreamble`**: prepended (with a blank line) to every YOLO prompt so the agent knows it is running headless and autonomous and shouldn't pause to ask questions. Set an empty string to disable entirely.
- **`yoloRecap`**: appended (with a blank line) to every YOLO prompt so the agent ends its run with a structured summary. Set an empty string to disable entirely.
- **`yoloArgs`**: no longer used. Old configs containing this key load without error; the key is silently ignored.

## Prompt library

A fresh install seeds a set of role-based prompts into `promptsDir` on first launch
(from the copies committed under `resources/prompts/`, bundled into the installer).
Seeding is non-destructive: it only fills in files you don't already have, so your
edits and deletions are never clobbered. Each covers one SDLC role against a Jira
ticket:

> The shipped prompts ask the agent to comment back on the Jira issue (e.g. `addCommentToJiraIssue`), which expects the optional [Atlassian MCP server](https://www.atlassian.com/platform/remote-mcp-server) to be configured in your CLI tool. Without it the agents still run and code; they just skip the Jira write-backs.

| Prompt | Role | What it does |
| --- | --- | --- |
| `orchestrator` | Default | Reads the request, decides what kind of work it needs, and does the whole job in one session. |
| `senior-dev` | Senior dev | Works the request on a feature branch: implements, adds + runs tests, commits, and opens a PR. |
| `fix-bug` | Bug fixer | Reproduces the bug, fixes the root cause, adds a failing-then-passing regression test, opens a PR. |
| `tech-lead` | Architect | Produces a short technical design and a suggested story breakdown before implementation. |
| `business-analyst` | BA | Breaks the source material into a Jira epic + child stories with acceptance criteria. |
| `reviewer` | Reviewer | Reviews the open PR / working changes against what the request must satisfy; reviews, doesn't implement. |
| `qa` | QA | Derives a test plan, writes Playwright e2e + unit tests, runs them, reports pass/fail per criterion. |
| `doc-writer` | Docs | Updates the user/dev docs to match the behavior a change introduces. |

Manage them from **Config → Prompt Config** (create, edit, delete). Prompt bodies
may use these template variables; anything else renders literally to the agent. In a
normal interactive or YOLO run the app is **key-only**: only `{{ticket.key}}` and
the `{{forge.*}}` values are filled, and the agent reads the rest of the ticket
itself through its Atlassian MCP. The other `{{ticket.*}}` placeholders below are
recognized but expand to empty strings by design.

| Variable | Expands to |
| --- | --- |
| `{{ticket.key}}` | Issue key, e.g. `PROJ-123` |
| `{{forge.term}}` | Forge's term for a change request, e.g. `PR` / `MR` |
| `{{forge.prCommand}}` | Configured PR-open command, resolved per repo |

## In-app configuration

The menu bar shows **File / Edit / Config / About**.

**Config → App Config** opens `config.yaml` in a built-in editor with schema validation. Saving applies the new config immediately: sessions opened after saving use the updated values; sessions already running are untouched. A save is rejected (precise error, file unchanged) if the YAML is invalid or fails schema validation.

**Config → Prompt Config** manages the prompts directory. From here you can:
- Edit the YOLO preamble text (the autonomy instruction prepended to every YOLO prompt telling the agent it's running headless and shouldn't pause to ask questions).
- Edit the YOLO recap text (the instruction appended to every YOLO prompt asking the agent to end with a structured summary).
- Create, edit, or delete prebuilt prompts; changes appear in the composer's Role list immediately, no restart required.

**File → New Session** (`Ctrl+N`) resets the app: all open sessions are closed and the layout returns to its initial state. If any sessions are running you are asked to confirm first.

**About** shows the application name, version, and credits.

## The YOLO tab

Launching a session with YOLO armed (or running `seniordev PROJ-123 --yolo developer`) opens a dedicated YOLO tab, no PTY, no TUI:

1. **Live log**: the agent's stdout/stderr streams through the configured parser and renders as a scrolling monospace log, using the same font as the interactive terminals. Tool calls appear as one-liners (e.g. `▸ Edit src/foo.ts`).

2. **PR cards**: every PR/MR URL detected anywhere in the output is surfaced as a card with an Open button. Monorepo runs that open several PRs produce several cards, in order.

3. **Recap**: the built-in `yoloRecap` instruction appended to each prompt asks the agent to end with `## Changes made` and `## Pull requests` sections, so the structured summary is always the last visible output.

4. **Stop button**: while the run is live, a **Stop** button at the bottom of the tab tree-kills the session (the agent and any git/gh processes it spawned) but keeps the tab open; log, PR cards, and the resume path all survive. Closing the tab also kills the session, but discards the log with it.

5. **Resume button**: after the run exits (finished, failed, or stopped), a **"Resume YOLO Session?"** button appears at the bottom of the tab if a session id was captured. Clicking it opens a new interactive terminal tab in the same repo cwd running `claude --resume <id>` (or `codex resume <id>`), so you can inspect diffs, answer follow-up questions, or iterate on the result without starting over. The YOLO tab stays open with the full log and PR links.

## Trigger from Jira (bookmarklet)

One click from a Jira issue launches SeniorDev via the `seniordev://` deep-link
protocol and prefills a fresh agent composer with the ticket key. You review it and
Launch yourself: SeniorDev never auto-runs from a link (never guess-and-run), so
there is no confirm gate to clear. See [SECURITY.md](SECURITY.md) for the deep-link
threat model.

The first protocol click in your browser shows the one-time OS prompt **Open
SeniorDev? Always allow**; tick "always allow" to skip re-prompting.

Create a bookmark with this as the URL:

```javascript
javascript:(function(){var m=location.href.match(/\/browse\/([A-Za-z][A-Za-z0-9]*-\d+)/)||location.search.match(/selectedIssue=([A-Za-z][A-Za-z0-9]*-\d+)/);if(m){location.href='seniordev://open?ticket='+m[1]}else{alert('No Jira issue key found in this URL')}})();
```

It works on issue detail pages (`/browse/KEY`) and board/backlog views (`?selectedIssue=KEY`).

The link also accepts optional `role` and `folder` query params to prefill more of
the composer, e.g. `seniordev://open?ticket=SD-6&role=fix-bug&folder=~/code/sd`.
`role` must be a prompt name; `folder` is prefilled as-is. Nothing launches either
way, you always review and press Launch.

## Develop

```bash
pnpm install
pnpm dev          # launch the app (electron-vite)
pnpm test         # vitest
pnpm typecheck
```

> node-pty is native; on first run electron-builder/electron-rebuild aligns it to the Electron ABI.

## Command line

These arguments are passed to the **installed app executable**; there is no
`seniordev` command on your `PATH` (the installer doesn't add one). Invoke the
platform executable directly (e.g. `SeniorDev.exe …` on Windows, `open -a SeniorDev
--args …` on macOS), or in development pass them after `pnpm dev --`. `seniordev`
below is shorthand for "the app executable".

```
<app-executable> [tickets...] [--interactive] [--yolo <prompt>] [--prompt <text|@file>] [--tool <name>]
```

- `seniordev PROJ-123 PROJ-124`: open the composer prefilled for both tickets.
- `seniordev PROJ-123 --yolo developer`: run the `developer` prompt headless on the ticket; a live log tab opens, PR cards surface on completion.
- `--tool codex`: override the default CLI tool.

## Package

```bash
pnpm dist         # installers into release/ (per-OS: NSIS / dmg / AppImage)
pnpm dist:dir     # unpacked app dir
```
