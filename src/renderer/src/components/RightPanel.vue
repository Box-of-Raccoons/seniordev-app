<script setup lang="ts">
import { ref } from 'vue'
import TerminalView from './TerminalView.vue'

defineProps<{ activeTicketKey: string | null }>()

interface Term { id: string; title: string }
const terms = ref<Term[]>([])
const activeId = ref<string | null>(null)
let counter = 0

function newSession(): void {
  counter += 1
  const id = `t${counter}-${Date.now()}`
  terms.value.push({ id, title: `Session ${counter}` })
  activeId.value = id
}

function closeTerm(id: string): void {
  const i = terms.value.findIndex((t) => t.id === id)
  if (i === -1) return
  terms.value.splice(i, 1)
  if (activeId.value === id) activeId.value = terms.value.at(-1)?.id ?? null
}
</script>

<template>
  <section class="right-panel">
    <div class="term-bar">
      <nav class="term-tabs">
        <button
          v-for="t in terms"
          :key="t.id"
          class="term-tab"
          :class="{ 'term-tab--active': t.id === activeId }"
          @click="activeId = t.id"
        >
          {{ t.title }}
          <span class="term-tab__close" @click.stop="closeTerm(t.id)">×</span>
        </button>
      </nav>
      <button class="new-session" @click="newSession">+ New session</button>
    </div>

    <div class="term-body">
      <div v-if="!terms.length" class="panel-empty">No sessions — start one with "New session".</div>
      <div
        v-for="t in terms"
        v-show="t.id === activeId"
        :key="t.id"
        class="term-slot"
      >
        <TerminalView :id="t.id" :ticket-key="activeTicketKey" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.term-bar { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--hairline); }
.term-tabs { display: flex; gap: 4px; flex: 1; flex-wrap: wrap; }
.term-tab {
  background: var(--surface); color: var(--ink-soft);
  border: 1px solid var(--hairline); border-radius: var(--radius-sm);
  padding: 5px 10px; cursor: pointer;
}
.term-tab--active { background: var(--surface-2); color: var(--ink); }
.term-tab__close { margin-left: 6px; color: var(--ink-muted); }
.new-session {
  background: var(--teal); color: var(--bg); border: 0;
  border-radius: var(--radius-sm); padding: 6px 12px; cursor: pointer; font-weight: 600; white-space: nowrap;
}
.new-session:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.term-body { flex: 1; position: relative; overflow: hidden; }
.term-slot { position: absolute; inset: 0; padding: 6px; }
</style>
