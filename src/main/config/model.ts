// Per-prompt / per-tool model selection (SD-5). A prompt template may declare a
// `model:` in its frontmatter; a CLI tool may declare a `defaultModel` fallback
// and a `modelArgs` template describing how it expresses a model on argv (e.g.
// ["--model", "{{model}}"]). Resolution order, highest wins:
//   prompt frontmatter model → tool defaultModel → nothing (CLI decides).
// When nothing resolves — or the tool has no modelArgs to express it — no argv
// entries are produced, so a config with neither field is byte-identical to
// today's launch (the "argv unchanged" contract).
//
// The resolved model is substituted STRUCTURALLY into its own argv entries and
// never concatenated into a shell line — see spawn-command.ts.

// A prompt's declared model is either a single string — applied to whichever
// tool runs it — or a per-tool map keyed by tool name, e.g.
//   model:
//     claude: claude-opus-4-8
//     codex: gpt-5
// so one prompt can name the right model for each tool a user might run it under.
export type PromptModel = string | Record<string, string>

// Narrow raw YAML frontmatter into a PromptModel: a string is kept as-is; an
// object keeps only its string-valued entries (non-string values and an empty
// map are dropped); anything else ⇒ undefined ("no model declared").
export function normalizePromptModel(value: unknown): PromptModel | undefined {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === 'string'
    )
    if (entries.length > 0) return Object.fromEntries(entries)
  }
  return undefined
}

// Resolve a prompt's declared model down to the string that applies to a given
// tool: a per-tool map yields that tool's entry (or nothing if it names no model
// for this tool); a bare string applies to whatever tool runs.
export function pickPromptModel(model: PromptModel | undefined, toolName: string): string | undefined {
  if (typeof model === 'string') return model
  if (model) return model[toolName]
  return undefined
}

export function resolveModelArgs(
  tool: { modelArgs?: readonly string[]; defaultModel?: string },
  promptModel?: string
): string[] {
  const model = promptModel?.trim() || tool.defaultModel?.trim() || ''
  const templates = tool.modelArgs ?? []
  if (!model || templates.length === 0) return []
  // Function replacer: a literal '$' in a model id must not trigger $&-style
  // replacement patterns (matches the resume/prompt substitution style elsewhere).
  return templates.map((a) => a.replace('{{model}}', () => model))
}
