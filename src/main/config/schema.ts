import { z } from 'zod'

export const HeadlessSchema = z.object({
  args: z.array(z.string()).default([]),
  outputParser: z.enum(['claude-stream-json', 'codex-jsonl', 'text']).default('text'),
  sessionIdPattern: z.string().optional()
})

export const CliToolSchema = z.object({
  command: z.string().min(1),
  interactiveArgs: z.array(z.string()).default([]),
  promptDelivery: z.enum(['stdin', 'arg']).default('stdin'),
  promptArg: z.string().optional(),
  // How this tool expresses a model on argv, e.g. ["--model", "{{model}}"].
  // Empty ⇒ the tool can't express a model, so none is ever appended.
  modelArgs: z.array(z.string()).default([]),
  // Fallback model when a prompt doesn't declare one. Empty/absent ⇒ append
  // nothing (today's behavior — let the CLI pick its own default).
  defaultModel: z.string().optional(),
  // Model ids offered as SUGGESTIONS where a model can be chosen per launch (the
  // schedules form). Purely a convenience list: nothing validates against it and
  // a model absent from it is still accepted, so an id this app has never heard
  // of stays usable the day it ships.
  models: z.array(z.string()).default([]),
  // Wrap a typed-in prompt in bracketed-paste markers (ESC[200~ … ESC[201~) so a
  // multi-line prompt lands as one composer block instead of submitting per line.
  // Set for TUIs that HONOR bracketed paste (codex); must stay off for TUIs that
  // don't consume the markers (claude), where the raw ESC acts as the Escape key.
  bracketedPaste: z.boolean().optional(),
  headless: HeadlessSchema.optional(),
  resumeArgs: z.array(z.string()).optional(),
  // How this tool pre-assigns a session id on argv at spawn, e.g.
  // ["--session-id", "{{sessionId}}"] (claude). Absent ⇒ the tool has no
  // launch-time id flag (codex) and its id is discovered post-hoc instead.
  sessionIdArgs: z.array(z.string()).optional(),
  // Regex sources the S1 buffer scan matches against a quiet TUI to tell "waiting
  // on you at an approval prompt" from ordinary idle output. Default [] so a tool
  // with none configured degrades to no prompt detection rather than throwing;
  // a config.yaml can add or replace patterns when a vendor reshuffles its TUI.
  approvalPatterns: z.array(z.string()).default([])
})

export const ForgeSchema = z.object({
  prCommand: z.string().default(''),
  term: z.string().default('PR'),
  urlPattern: z.string().min(1)
})

export const RepoSchema = z.object({
  key: z.string().min(1),
  path: z.string().min(1),
  branchPrefix: z.string().default(''),
  forge: z.string().optional(),
  // Supervision slice 2: the project's own gate, run when a session in this repo
  // falls quiet. Empty (the default) means no gate runs, so configuring one IS
  // the opt-in — the app never guesses a command to execute in your repo.
  gate: z.string().default('')
})

export const ConfigSchema = z.object({
  defaultTool: z.string().default('claude'),
  cliTools: z.record(CliToolSchema).default({}),
  defaultForge: z.string().default('github'),
  forges: z.record(ForgeSchema).default({}),
  repos: z.array(RepoSchema).default([]),
  promptsDir: z.string().optional(),
  yoloPreamble: z.string().optional(),
  yoloRecap: z.string().optional(),
  // Minimum width, in px, a workspace pane can be resized to (S2 split panes).
  // Configurable because VS Code's fixed ~329px minimum is their single
  // most-requested change in this area; 320 is a sensible default.
  minPaneWidth: z.number().int().positive().default(320),
  // Days of inactivity after which a project is auto-archived (S3, spec 4.5).
  // Runs at startup + daily, never archives a project with a live tab, and is
  // fully reversible. 0 disables archiving. Non-negative integer.
  archiveAfterDays: z.number().int().nonnegative().default(14),
  // Supervision slice 2. `defaultGate` covers folders that are not in `repos:`
  // (the answer to "where does the gate command live for an unconfigured
  // folder"); a repo's own `gate` always wins. Empty means no gate anywhere.
  defaultGate: z.string().default(''),
  // A gate that hangs must not hang forever. Killed at this point and reported
  // as an error, which is distinct from a failing suite.
  gateTimeoutMs: z.number().int().positive().default(300_000),
  // Supervision slice 3a: USD per MILLION tokens, merged over the bundled
  // table. Model prices change and new models ship, so this exists to correct a
  // stale bundled rate or price a model the app has never heard of. A model
  // with no rate anywhere reports tokens and no cost, rather than a guess.
  modelRates: z
    .record(z.object({ input: z.number().nonnegative(), output: z.number().nonnegative() }))
    .default({})
})

export type Config = z.infer<typeof ConfigSchema>
