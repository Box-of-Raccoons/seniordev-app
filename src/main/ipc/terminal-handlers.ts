import { ipcMain } from 'electron'
import type { Config } from '../config/schema'
import { TerminalManager, type PtySpawner } from '../terminal/manager'
import { buildInteractiveLaunch } from '../terminal/session'
import { TERM, type SpawnTerminalRequest, type SpawnResult } from '../../shared/ipc'

export function registerTerminalIpc(
  config: Config,
  getSender: () => Electron.WebContents | undefined,
  spawner: PtySpawner
): TerminalManager {
  const manager = new TerminalManager(spawner, {
    onData: (id, data) => getSender()?.send(TERM.data, { id, data }),
    onExit: (id, exitCode) => getSender()?.send(TERM.exit, { id, exitCode })
  })

  ipcMain.handle(TERM.spawn, (_e, req: SpawnTerminalRequest): SpawnResult => {
    try {
      const launch = buildInteractiveLaunch(config, req)
      manager.spawn(req.id, { ...launch, cols: req.cols, rows: req.rows })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.on(TERM.write, (_e, id: string, data: string) => manager.write(id, data))
  ipcMain.on(TERM.resize, (_e, id: string, cols: number, rows: number) => manager.resize(id, cols, rows))
  ipcMain.on(TERM.kill, (_e, id: string) => manager.kill(id))

  return manager
}
