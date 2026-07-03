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

export const JiraSchema = z.object({
  baseUrl: z.string().url(),
  email: z.string().email(),
  apiToken: z.string().min(1)
})

export const WatchSchema = z.object({
  enabled: z.boolean().default(false),
  intervalSeconds: z.number().int().positive().default(300),
  label: z.string().min(1).default('SeniorDev'),
  triggerStatusCategory: z.string().min(1).default('To Do'),
  transitionOnDispatch: z.string().min(1).default('In Progress'),
  autoMode: z.boolean().default(false),
  // Notify (with a click-to-kill action) if a single classify or run exceeds
  // this many seconds. 0 disables the warning.
  runWarnSeconds: z.number().int().nonnegative().default(0)
})

export type WatchConfig = z.infer<typeof WatchSchema>

export const ConfigSchema = z.object({
  jira: JiraSchema,
  ticketContext: z.enum(['key-only', 'both']).default('both'),
  defaultTool: z.string().default('claude'),
  cliTools: z.record(CliToolSchema).default({}),
  defaultForge: z.string().default('github'),
  forges: z.record(ForgeSchema).default({}),
  repos: z.array(RepoSchema).default([]),
  watch: WatchSchema.default({}),
  promptsDir: z.string().optional(),
  yoloPreamble: z.string().optional(),
  yoloRecap: z.string().optional()
})

export type Config = z.infer<typeof ConfigSchema>
