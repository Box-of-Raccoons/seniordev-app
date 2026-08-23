import { ipcMain } from 'electron'
import { SCHEDULES } from '../../shared/ipc'
import type { Schedule, ScheduleCreate, SchedulesStore } from '../schedule/schedules-store'
import type { ScheduleRunner } from '../schedule/runner'

// The renderer's surface over the schedules store. Reads and the three mutations
// the UI owns; the firing itself is the runner's, and nothing here can trigger
// one. Every mutation nudges the renderer to re-read rather than returning a
// patch, matching how the sidebar keeps itself in step (SIDEBAR.changed).
export function registerScheduleIpc(deps: {
  store: SchedulesStore
  getSender: () => Electron.WebContents | undefined
  // Evaluated right after a create so a schedule made for a moment that has
  // already arrived is picked up now rather than up to a tick later.
  runner?: ScheduleRunner
}): void {
  const changed = (): void => void deps.getSender()?.send(SCHEDULES.changed)

  ipcMain.handle(SCHEDULES.list, (): Schedule[] => deps.store.list())

  ipcMain.handle(SCHEDULES.create, (_e, c: ScheduleCreate): Schedule => {
    const created = deps.store.create(c)
    changed()
    deps.runner?.tick()
    return created
  })

  ipcMain.handle(SCHEDULES.setEnabled, (_e, id: string, enabled: boolean): void => {
    deps.store.setEnabled(id, enabled)
    changed()
  })

  ipcMain.handle(SCHEDULES.remove, (_e, id: string): void => {
    deps.store.remove(id)
    changed()
  })
}
