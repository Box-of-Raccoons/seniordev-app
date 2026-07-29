<script setup lang="ts">
import type { TabStatus } from '../../../shared/ipc'

// One inline-SVG glyph per S1 status (spec 5.1). Drawn as SVG, not a font char,
// because glyph rendering differs across Windows and macOS. Each state has a
// distinct silhouette so colour only reinforces it, never carries it alone
// (DESIGN.md Color-Is-State Rule): working = solid circle, idle = hollow ring,
// needsYou = triangle, needsReview = diamond, failed = cross. A null status (a
// composer tab with no pty, or a conversation with no live tab) renders nothing.
const props = defineProps<{ status: TabStatus | null }>()

const LABELS: Record<TabStatus, string> = {
  working: 'working',
  idle: 'idle',
  needsYou: 'needs you',
  needsReview: 'needs review',
  failed: 'failed'
}
</script>

<template>
  <span
    v-if="props.status"
    class="status-glyph"
    role="img"
    :aria-label="LABELS[props.status]"
    :title="LABELS[props.status]"
  >
    <!-- working: solid amber circle, slow colour pulse; static solid under reduced motion. -->
    <svg v-if="props.status === 'working'" width="14" height="14" viewBox="0 0 16 16">
      <circle class="work-pulse" cx="8" cy="8" r="5" fill="var(--amber)" />
    </svg>

    <!-- idle: hollow ink-muted ring (solid-vs-hollow keeps it distinct from working). -->
    <svg v-else-if="props.status === 'idle'" width="14" height="14" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="5" fill="none" stroke="var(--ink-muted)" stroke-width="1.7" />
    </svg>

    <!-- needsYou: amber triangle, bouncing; a heavier static triangle under reduced motion. -->
    <template v-else-if="props.status === 'needsYou'">
      <svg class="rm-hide" width="14" height="14" viewBox="0 0 16 16">
        <path class="bounce" d="M8 3 L13.5 13 L2.5 13 Z" fill="var(--amber)" />
      </svg>
      <svg class="rm-only" width="14" height="14" viewBox="0 0 16 16">
        <path d="M8 2 L14.5 13.5 L1.5 13.5 Z" fill="var(--amber)" />
        <path d="M8 2 L14.5 13.5 L1.5 13.5 Z" fill="none" stroke="var(--amber)" stroke-width="2.4" stroke-linejoin="round" />
      </svg>
    </template>

    <!-- needsReview: green diamond. -->
    <svg v-else-if="props.status === 'needsReview'" width="14" height="14" viewBox="0 0 16 16">
      <path d="M8 2 L14 8 L8 14 L2 8 Z" fill="var(--green)" />
    </svg>

    <!-- failed: rust cross. -->
    <svg v-else-if="props.status === 'failed'" width="14" height="14" viewBox="0 0 16 16">
      <path d="M4.5 4.5 L11.5 11.5 M11.5 4.5 L4.5 11.5" stroke="var(--rust)" stroke-width="2.2" stroke-linecap="round" />
    </svg>
  </span>
</template>

<style scoped>
.status-glyph { display: inline-flex; align-items: center; }
.status-glyph svg { display: block; }

/* working: the fill breathes amber -> dimmer amber and back. Size never changes. */
@keyframes sd-work {
  0%, 100% { fill: var(--amber); }
  50% { fill: var(--amber-dim); }
}
.work-pulse { animation: sd-work 2.8s ease-in-out infinite; }

/* needsYou: the "pay attention" bounce. */
@keyframes sd-bounce {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.8); }
}
.bounce { transform-box: fill-box; transform-origin: center; animation: sd-bounce 1.4s ease-in-out infinite; }

/* Motion conveys state, so it must survive with animation off: working goes
   static (still a solid amber circle), needsYou swaps to the heavier triangle. */
.rm-only { display: none; }
@media (prefers-reduced-motion: reduce) {
  .work-pulse { animation: none; }
  .bounce { animation: none; }
  .rm-hide { display: none; }
  .rm-only { display: inline-flex; }
}
</style>
