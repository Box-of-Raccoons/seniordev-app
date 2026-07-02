import { ipcMain } from 'electron'
import type { PromptTemplate } from '../prompts/library'
import { PROMPTS, type PromptSummary } from '../../shared/ipc'

export function registerPromptsIpc(prompts: PromptTemplate[]): void {
  ipcMain.handle(PROMPTS.list, (): PromptSummary[] =>
    prompts.map((p) => ({ name: p.name, description: p.description }))
  )
}
