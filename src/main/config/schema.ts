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
  // Wrap a typed-in prompt in bracketed-paste markers (ESC[200~ … ESC[201~) so a
  // multi-line prompt lands as one composer block instead of submitting per line.
  // Set for TUIs that HONOR bracketed paste (codex); must stay off for TUIs that
  // don't consume the markers (claude), where the raw ESC acts as the Escape key.
  bracketedPaste: z.boolean().optional(),
  headless: HeadlessSchema.optional(),
  resumeArgs: z.array(z.string()).optional()
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
  forge: z.string().optional()
})

export const ConfigSchema = z.object({
  defaultTool: z.string().default('claude'),
  cliTools: z.record(CliToolSchema).default({}),
  defaultForge: z.string().default('github'),
  forges: z.record(ForgeSchema).default({}),
  repos: z.array(RepoSchema).default([]),
  promptsDir: z.string().optional(),
  yoloPreamble: z.string().optional(),
  yoloRecap: z.string().optional()
})

export type Config = z.infer<typeof ConfigSchema>
