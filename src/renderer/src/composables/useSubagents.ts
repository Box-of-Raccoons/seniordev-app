import { computed, reactive, ref, type ComputedRef, type Ref } from 'vue'
import {
  applySpawn,
  applyActivity,
  applyDone,
  pruneStale,
  sortTiles,
  filterTiles,
  tileStatus,
  relativeLabel,
  type TileMap,
  type SubagentTile,
  type SubagentStatus
} from './subagent-tiles'
import type { SubagentSpawnEvent, SubagentActivityEvent, SubagentDoneEvent } from '../../../shared/ipc'

// The live data behind the S8 subagent panel. Subscribes to the main-process
// watchers' one-way pushes, assembles tiles (via the pure subagent-tiles logic),
// and exposes a sorted + app-filtered view plus a 1s clock for relative time and
// status. Deliberately owns its own IPC + interval (unlike useWorkspace, which is
// pure state) because it IS the event sink; the panel just calls start()/stop().
// The api + clock are injectable so it is unit-testable without window/IPC.
export interface SubagentApi {
  onSubagentSpawn: (cb: (e: SubagentSpawnEvent) => void) => () => void
  onSubagentActivity: (cb: (e: SubagentActivityEvent) => void) => () => void
  onSubagentDone: (cb: (e: SubagentDoneEvent) => void) => () => void
}

export interface UseSubagents {
  tiles: ComputedRef<SubagentTile[]> // sorted (recent-first) + app-filtered
  totalCount: ComputedRef<number> // unfiltered tile count (for "N hidden" context)
  appOnly: Ref<boolean> // "this app only" — the panel binds + persists this
  statusOf: (tile: SubagentTile) => SubagentStatus
  labelOf: (tile: SubagentTile) => string
  setKnownSessions: (ids: Iterable<string>) => void
  clearFinished: () => void
  start: () => void
  stop: () => void
}

export function useSubagents(opts?: { api?: SubagentApi; now?: () => number; tickMs?: number }): UseSubagents {
  const api = opts?.api ?? (window.api as unknown as SubagentApi)
  const clock = opts?.now ?? ((): number => Date.now())
  const tickMs = opts?.tickMs ?? 1000

  const record = reactive<TileMap>({})
  const now = ref(clock())
  const appOnly = ref(false)
  const knownSessions = ref<Set<string>>(new Set())

  const tiles = computed(() => filterTiles(sortTiles(Object.values(record)), appOnly.value, knownSessions.value))
  const totalCount = computed(() => Object.keys(record).length)

  const statusOf = (tile: SubagentTile): SubagentStatus => tileStatus(tile, now.value)
  const labelOf = (tile: SubagentTile): string => relativeLabel(tile.lastTs, now.value)
  const setKnownSessions = (ids: Iterable<string>): void => {
    knownSessions.value = new Set(ids)
  }
  // Drop finished/stale tiles so the panel stays about what is running now.
  const clearFinished = (): void => {
    for (const [k, t] of Object.entries(record)) {
      const s = tileStatus(t, now.value)
      if (s === 'done' || s === 'stale') delete record[k]
    }
  }

  let offs: Array<() => void> = []
  let timer: ReturnType<typeof setInterval> | null = null
  const start = (): void => {
    offs.push(api.onSubagentSpawn((e) => applySpawn(record, e)))
    offs.push(api.onSubagentActivity((e) => applyActivity(record, e)))
    offs.push(api.onSubagentDone((e) => applyDone(record, e)))
    now.value = clock()
    timer = setInterval(() => {
      now.value = clock()
      pruneStale(record, now.value) // self-clean tiles quiet past REMOVE_MS
    }, tickMs)
  }
  const stop = (): void => {
    offs.forEach((off) => off())
    offs = []
    if (timer != null) {
      clearInterval(timer)
      timer = null
    }
  }

  return { tiles, totalCount, appOnly, statusOf, labelOf, setKnownSessions, clearFinished, start, stop }
}
