import { ipcMain } from 'electron'
import { GATE } from '../../shared/ipc'
import type { GateService } from '../gate/gate-service'

// Supervision slice 2. Results are PUSHED from the service (main → renderer);
// these two handlers are the renderer's only calls into it. The full gate output
// is fetched on demand rather than pushed, so a noisy suite never rides through
// an event.
export function registerGateIpc(deps: { gates: GateService }): void {
  ipcMain.handle(GATE.output, (_e, ptyId: string): string | null => deps.gates.outputFor(ptyId))
  // Run it now, without waiting for the session to settle — the manual half of
  // the same gate, for when you want the answer before the agent stops talking.
  ipcMain.handle(GATE.run, async (_e, ptyId: string): Promise<void> => {
    await deps.gates.runNow(ptyId)
  })
}
