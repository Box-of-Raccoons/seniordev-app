# SeniorDev — In-app configuration

**Date:** 2026-07-03
**Status:** Approved (brainstorming) — pending spec review
**Branch:** `feature/in-app-config` (off develop)

## One-liner

Replace the default Electron menu with **File / Edit / Config / About**; Config
opens two in-app modal editors — **App Config** (raw-YAML edit of `config.yaml`
with validate-first save and live in-place reload) and **Prompt Config** (edit
the new `{{ticket.context}}` injection template, the `yoloRecap` text, and full
CRUD of prebuilt prompt files); File → New Session resets the workbench to the
empty baseline; About shows name, version, and "By Box of Raccoons LLC, 2026".

## Decisions (locked during brainstorming)

| Fork | Decision | Why |
|---|---|---|
| Injection editing | **New editable context template** — `_ticket-context.md` in `promptsDir` defining `{{ticket.context}}`; Prompt Config edits it + `yoloRecap` + prompt CRUD | One standard context block prompts can reference instead of hand-rolling fields; shipped default preserves today's layout. |
| App Config editor | **Raw YAML editor + validation** | Matches "change the values in the yaml file" literally; handles every field incl. future ones; Zod errors carry the UX weight. Rejected: structured form (large, YAGNI), hybrid (two paths to sync). |
| Menu tech | **Native Electron menu** (`Menu.setApplicationMenu`) → IPC → renderer modals | OS-native look, zero layout work; menu stays dumb, renderer testable. Rejected: custom HTML bar (frameless-window tax). |
| Reload mechanism | **Approach A: mutable `ConfigStore` in main** — handlers read current config at call time | True live reload; same mechanism powers prompt CRUD refresh. Rejected: B `app.relaunch()` (kills sessions, still needs store for prompts), C re-register IPC (leaked `.on` listeners, orphaned managers). |
| Reload scope | **New work only** | Running PTYs/YOLO runs copied their launch at spawn; in-flight fetches finish on the old client. |
| New Session | **Confirm when live sessions exist; clean slate** | Closes all tickets + sessions via existing close paths; does NOT re-apply startup CLI args. |

## Menu (`src/main/menu.ts`)

- **File** → New Session (`CmdOrCtrl+N`), separator, Exit (`role: 'quit'`).
- **Edit** → `role: 'editMenu'` — required so copy/paste accelerators keep
  working (macOS especially); Windows could live without it, kept for parity.
- **Config** → App Config…, Prompt Config…
- **About** → About SeniorDev.

Items only send IPC to the focused window: `menu:new-session`,
`menu:open-app-config`, `menu:open-prompt-config`, `menu:about`. All work
happens in the renderer. The default Electron menu is gone.

**About** = in-app modal (app-styled): name + version from `app.getVersion()`
via `app:info` IPC, and the line `By Box of Raccoons LLC, 2026`. Dismiss on
Escape / click-outside / OK.

## ConfigStore (`src/main/config/store.ts`)

```ts
class ConfigStore {
  config: Config | null          // null = config failed to load
  jiraClient: JiraClient | null
  prompts: PromptTemplate[]      // SAME array instance forever — mutated in place
  loadError: string | null

  reload(): { ok: true } | { ok: false; error: string }   // keeps last-good on failure
  reloadPrompts(): void                                    // splice+push in place
}
```

- `reload()` re-runs `loadConfig` (presets merge + Zod), swaps `config`,
  rebuilds `jiraClient`, refreshes prompts. Failure returns the error and
  changes nothing — a bad save can never brick a running app.
- `prompts` is mutated in place because `terminal-handlers`/`yolo-handlers`
  hold the array reference; mutation propagates with no signature change on
  the deps object.
- Registrations change from `config: Config` to `getConfig: () => Config`
  (terminal, yolo); `getTicket` reads `store.jiraClient` at call time;
  prompts IPC reads the live array. `main/index.ts` builds one store and
  wires everything through it.
- The app now boots its window even with invalid config: terminal/yolo IPC is
  always registered and returns `"config not loaded: <error>"` failures — which
  is what lets the user FIX a broken config from inside the app.
- After successful save+reload, main broadcasts `config:changed`; open UI
  (NewSessionMenu prompt list, yolo-caps gate) refetches.

## App Config editor

IPC (`src/main/ipc/config-handlers.ts`):

```
config:read  (invoke) → { ok:true, text, path, isTemplate?: true } | { ok:false, error }
config:save  (invoke) { text } → { ok:true } | { ok:false, error }
app:info     (invoke) → { name, version }
```

- `config:read` returns the raw file text (comments/formatting preserved).
  Missing file → returns `config.example.yaml` contents with `isTemplate: true`.
- `config:save` is validate-first: `loadConfig` is refactored to expose a
  `parseConfig(text)` core shared by file-boot and text-validation → on
  success, atomic write (temp + rename) → `store.reload()` → broadcast. On
  failure nothing is written; the error string (YAML syntax error with line
  number, or Zod path + message) returns verbatim.

UI — `AppConfigModal.vue`: monospace `<textarea>` (term-style font), file path
in the header, error strip on failed save, Save / Cancel. Dirty-state guard on
Cancel/Escape ("Discard changes?"). No syntax highlighting (YAGNI).

Secrets: the Jira API token is visible in this editor — same exposure as any
text editor on the file; the token still never reaches the renderer outside
this deliberate edit surface. Accepted for a local dev tool.

## Prompt Config

`PromptConfigModal.vue` — two panes: list left (specials pinned on top, then
prompts), editor right.

**Special 1 — Ticket context template** (`_ticket-context.md` in `promptsDir`;
leading `_` = excluded from the launchable prompt list):

- Defines what `{{ticket.context}}` expands to, using `{{ticket.*}}`
  placeholders. Shipped default (in code; written to disk on first edit):

  ```
  Work Jira ticket {{ticket.key}}: "{{ticket.summary}}"

  {{ticket.description}}

  Acceptance criteria:
  {{ticket.acceptanceCriteria}}
  ```

- `expand.ts` gains the `ticket.context` key: the template's own `{{ticket.*}}`
  fields are filled (one level — a `{{ticket.context}}` inside the template is
  ignored to prevent loops). `ticketContext: key-only` collapses fields exactly
  as today. Existing prompts unchanged; new prompts may just write
  `{{ticket.context}}`.

**Special 2 — YOLO recap** (edits `yoloRecap` in `config.yaml`):

- Shows the effective text (config value, or built-in default with a
  "using built-in default" badge). Save writes ONLY that key via the `yaml`
  package's document API (comments/formatting elsewhere preserved) and reloads
  through the same machinery. Clearing back to default deletes the key.

**Prompt CRUD** (`.md` files in `promptsDir`):

- List: name + description from frontmatter.
- Create: filename-safe unique name → skeleton with frontmatter.
- Edit: raw markdown (frontmatter + body as one text); save validates the
  frontmatter parses and the name doesn't collide with another file's.
- Delete: confirm dialog → remove file.
- Every write → `store.reloadPrompts()` → `config:changed` broadcast.

IPC: `prompts:read {name}`, `prompts:write {name, text}`, `prompts:create
{name}`, `prompts:delete {name}`, `prompts:readContext`,
`prompts:writeContext`, `config:readRecap`, `config:saveRecap`. All file I/O in
main; renderer never touches the filesystem. Prompt writes are atomic;
`promptsDir` is created on first write if absent.

## File → New Session

`menu:new-session` lands in `App.vue`. If any terminal/yolo tab exists,
confirm: "Close all tickets and sessions? Running sessions will be killed."
On confirm:

- `RightPanel.closeAll()` — closes each tab through the existing `closeTerm`
  path so unmount hooks fire (`killTerminal` / `killYolo` tree-kill).
- `LeftPanel.closeAll()` — closes ticket tabs, clears active key + input.
- Config, prompts, window state untouched. Startup CLI args NOT re-applied.

## Error handling

- Validate-first saves; keep-last-good reload; atomic file writes.
- Name-collision and frontmatter validation on prompt saves; delete confirms.
- Menu events while a modal is open focus the existing modal, never stack.
- Boot with broken config: window opens, editors work, session IPC returns
  clear errors.

## Testing

- **Unit (main):** `ConfigStore.reload` (good→good, good→bad keeps last-good,
  prompts array identity stable); `parseConfig` (YAML line errors, Zod path
  errors); recap YAML-document round-trip (comment-preserving, byte-stable
  fixture); `{{ticket.context}}` expansion (recursion guard, key-only
  collapse); prompt CRUD handlers against a temp dir (create/edit/delete/
  collision/`_`-exclusion).
- **Unit (renderer):** AppConfigModal (load, save-error strip, dirty guard);
  PromptConfigModal (list, CRUD flows); About (name/version/credit);
  App.vue New Session confirm → both `closeAll()`s.
- **Manual (user):** Windows native menu look/accelerators; real edit → save →
  new session uses new value while an old session keeps running; prompt
  created in-app appears in the YOLO menu without restart.
