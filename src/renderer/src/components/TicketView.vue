<script setup lang="ts">
import { computed } from 'vue'
import type { Ticket } from '../../../shared/types'
import { renderAdfToHtml } from '../adf/renderToHtml'

const props = defineProps<{ ticket: Ticket }>()
const bodyHtml = computed(() => renderAdfToHtml(props.ticket.descriptionAdf))
</script>

<template>
  <article class="ticket">
    <header class="ticket__head">
      <a class="ticket__key" :href="ticket.url" target="_blank" rel="noreferrer noopener">{{ ticket.key }}</a>
      <span class="ticket__type">{{ ticket.type }}</span>
      <span class="ticket__status">{{ ticket.status }}</span>
    </header>
    <h1 class="ticket__summary">{{ ticket.summary }}</h1>
    <!-- Safe: renderAdfToHtml escapes all text and emits only known tags. -->
    <div class="ticket__body" v-html="bodyHtml"></div>
  </article>
</template>

<style scoped>
.ticket { padding: 16px 20px; overflow: auto; }
.ticket__head { display: flex; gap: 10px; align-items: center; color: var(--ink-muted); font-size: 12px; }
.ticket__key { color: var(--teal); text-decoration: none; font-weight: 600; }
.ticket__status { color: var(--amber); }
.ticket__summary { font-size: 18px; margin: 8px 0 12px; color: var(--ink); }
.ticket__body { max-width: 72ch; }
.ticket__body :is(h1,h2,h3) { color: var(--ink); }
.ticket__body a { color: var(--teal); }
.ticket__body code { background: var(--surface-2); padding: 0 4px; border-radius: var(--radius-sm); }
.ticket__body pre { background: var(--surface-2); padding: 10px; border-radius: var(--radius-sm); overflow: auto; }
/* Callouts use a full border + type-keyed background tint (no side-stripe accent). */
.adf-panel {
  border: 1px solid var(--hairline-strong);
  background: color-mix(in oklch, var(--teal) 10%, var(--surface));
  padding: 10px 12px; border-radius: var(--radius-sm); margin: 8px 0;
}
.adf-panel--warning {
  background: color-mix(in oklch, var(--amber) 10%, var(--surface));
  border-color: color-mix(in oklch, var(--amber) 30%, var(--hairline-strong));
}
.adf-panel--error {
  background: color-mix(in oklch, var(--rust) 12%, var(--surface));
  border-color: color-mix(in oklch, var(--rust) 35%, var(--hairline-strong));
}
</style>
