# Security notes

SeniorDev launches coding agents on your machine. This document records the threat
model for the security-sensitive surfaces and a couple of consciously accepted
tradeoffs. Please report vulnerabilities privately to
`hardy.spry@boxofraccoons.dev` rather than opening a public issue.

## Deep links

The app registers the `seniordev://` protocol, so any web page can navigate to a
`seniordev://open?ticket=KEY` URL. Treat deep links as **untrusted, web-reachable
input**. SeniorDev's response is deliberately inert: a deep link only **prefills a
composer** (the ticket key, and optionally a role and folder) in a new tab. It
never launches anything. The developer reviews the prefilled composer and clicks
Launch themselves, so no external trigger can start an agent run (never
guess-and-run). The prefill values are carried as plain strings and are never
passed through a shell. (`src/main/deeplink/parse.ts`, `src/renderer/src/App.vue`.)

## Agents read tickets, SeniorDev does not

SeniorDev holds **no credentials**. Given a ticket key it hands the bare key to the
agent, which reads the issue through its own Atlassian MCP under the agent's own
authentication; the app never fetches or renders ticket content. One consequence
carries over from the old design: because an agent can act on a ticket's content,
treat any ticket an untrusted party can file or comment on as
**attacker-authorable** (prompt-injection into an autonomous agent is code
execution). Point a YOLO run only at work whose ticket authors you trust.

## Renderer hardening

- `setWindowOpenHandler` / `will-navigate` on the main window deny in-app
  navigation and route `http(s)` links out through the OS browser via the vetted
  `shell.openExternal` path. (`src/main/index.ts`.)
- A Content-Security-Policy is set for packaged builds (`default-src 'self'`).

## Prompt delivery

Prompts are typed into a CLI agent's TUI over a PTY, never assembled onto a
`cmd /c` command line where untrusted text could be re-parsed: when a tool resolves
to a Windows `.cmd` shim, argument delivery downgrades to typing the prompt into the
TUI. Bracketed-paste framing (which contains raw ESC bytes) is applied only for
tools that opt in and are known to consume it (codex), never for tools where the
ESC would leak as an Escape keypress (claude). (`src/main/terminal/session.ts`,
`src/main/ipc/terminal-handlers.ts`.)

## Accepted tradeoffs

- **Renderer `sandbox: false`.** The renderer runs with `sandbox: false` because the
  preload is an ESM (`.mjs`) module and sandboxed preloads must be CommonJS.
  `contextIsolation` is on and `nodeIntegration` is off, so the renderer still has
  no direct Node access and only the explicit `contextBridge` API surface. Restoring
  the sandbox (convert the preload to CJS, set `sandbox: true`) is tracked as a
  follow-up. (`src/main/index.ts`.)
