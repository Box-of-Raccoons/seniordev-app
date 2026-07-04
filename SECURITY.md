# Security notes

SeniorDev launches autonomous coding agents on your machine. This document records
the threat model for the security-sensitive surfaces and a couple of consciously
accepted tradeoffs. Please report vulnerabilities privately to
`hardy.spry@boxofraccoons.dev` rather than opening a public issue.

## Deep links and autonomous ("YOLO") runs

The app registers the `seniordev://` protocol. Any web page can navigate to a
`seniordev://open?ticket=KEY` or `seniordev://yolo?ticket=KEY` URL, so deep links
are **untrusted, web-reachable input**. Two things follow:

- **`seniordev://yolo` never runs silently.** It opens the ticket and then shows a
  confirm dialog that (a) announces the run was *triggered by an external link*,
  (b) names the CLI tool and the resolved repository path, and (c) is **refused
  outright** if the ticket's project maps to no configured repo — SeniorDev will
  not start an autonomous session in a fallback directory from an external
  trigger. (`src/renderer/src/App.vue`, `src/main/ipc/handlers.ts`.)
- **The no-confirm `--orchestrate` path is CLI-only.** It is used by the local
  SeniorDevWatch tray. If a launch's argv also carries a `seniordev://` deep link,
  the `--orchestrate` flag from that same argv is ignored, so a lost-quoting quirk
  cannot smuggle a no-confirm run past the gate. (`src/main/index.ts`
  `second-instance`.)

Because a YOLO prompt is built from Jira ticket content, treat any ticket you can
autonomously run as **attacker-authorable if untrusted parties can file or comment
on it** — prompt-injection into an autonomous agent is code execution. Only enable
watch/auto mode against projects whose ticket authors you trust.

## Renderer hardening

- `setWindowOpenHandler` / `will-navigate` on the main window deny in-app
  navigation and route `http(s)` links out through the OS browser via the vetted
  `shell.openExternal` path. The ADF→HTML renderer additionally allowlists hrefs to
  `https:`/`mailto:`. (`src/main/index.ts`.)
- A Content-Security-Policy is set for packaged builds (`default-src 'self'`).

## Transport

- `jira.baseUrl` **must be `https://`** — the client sends the API token as HTTP
  Basic auth, so an `http://` base URL would leak it in cleartext. This is enforced
  by config schema validation. (`src/main/config/schema.ts`.)

## Accepted tradeoffs

- **Renderer `sandbox: false`.** The renderer runs with `sandbox: false` because the
  preload is an ESM (`.mjs`) module and sandboxed preloads must be CommonJS.
  `contextIsolation` is on and `nodeIntegration` is off, so the renderer still has
  no direct Node access and only the explicit `contextBridge` API surface. Restoring
  the sandbox (convert the preload to CJS, set `sandbox: true`) is tracked as a
  follow-up. (`src/main/index.ts`.)
