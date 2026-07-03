import type { PromptTemplate } from '../prompts/library'

// One '- name: description' line per playbook, for the classifier's
// {{prompts.catalog}} slot. The orchestrator itself must never appear in its own
// catalog (loadPrompts already excludes _-prefixed files, but guard defensively).
export function buildCatalog(prompts: PromptTemplate[]): string {
  const lines = prompts
    .filter((p) => p.name !== 'jira-orchestrator')
    .map((p) => `- ${p.name}: ${p.description || '(no description)'}`)
  return lines.length ? lines.join('\n') : '(no playbooks available)'
}
