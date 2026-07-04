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
