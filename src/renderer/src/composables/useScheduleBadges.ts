import { ref, type Ref } from 'vue'
import type { Schedule } from '../../../shared/ipc'

// Which conversations have something queued to type into them. A schedule that
// will act on a session unattended should be visible ON that session, not only
// inside the Schedules modal (design principle 1, "show the work, always").
//
// One instance, created in App and passed to the sidebar and the tab strip the
// same way `ws` and `subagents` are, so the list is fetched once rather than by
// each consumer.

export interface UseScheduleBadges {
  schedules: Ref<Schedule[]>
  // Ticks so a rendered "next in 20m" does not sit stale on screen.
  now: Ref<number>
  start(): void
  stop(): void
  // The soonest enabled schedule aimed at this conversation, or null. A disabled
  // or retired one is deliberately not surfaced: nothing is going to happen.
  soonestFor(conversationId: string): Schedule | null
}

const REFRESH_MS = 15_000

export function useScheduleBadges(): UseScheduleBadges {
  const schedules = ref<Schedule[]>([])
  const now = ref(Date.now())
  let offChanged: (() => void) | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  async function refresh(): Promise<void> {
    try {
      schedules.value = await window.api.listSchedules()
    } catch {
      // Best effort: a failed read leaves the badges off rather than breaking a
      // sidebar that has nothing to do with scheduling.
      schedules.value = []
    }
  }

  return {
    schedules,
    now,
    start() {
      void refresh()
      // Optional-called: the sidebar must not break on a preload without it.
      offChanged = window.api.onSchedulesChanged?.(() => void refresh()) ?? null
      timer = setInterval(() => {
        now.value = Date.now()
      }, REFRESH_MS)
    },
    stop() {
      offChanged?.()
      offChanged = null
      if (timer) clearInterval(timer)
      timer = null
    },
    soonestFor(conversationId) {
      let best: Schedule | null = null
      for (const s of schedules.value) {
        if (!s.enabled) continue
        if (s.target.kind !== 'conversation' || s.target.conversationId !== conversationId) continue
        if (!best || s.nextDueAt < best.nextDueAt) best = s
      }
      return best
    }
  }
}
