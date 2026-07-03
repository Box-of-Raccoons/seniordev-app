<script setup lang="ts">
import { ref } from 'vue'
import TerminalView from './TerminalView.vue'
import NewSessionMenu from './NewSessionMenu.vue'

defineProps<{ activeTicketKey: string | null }>()

interface Term { id: string; title: string; prompt?: { name?: string; text?: string }; yolo?: boolean; tool?: string; exited?: boolean }
const terms = ref<Term[]>([])
const activeId = ref<string | null>(null)
let counter = 0

function startSession(payload: { prompt?: { name?: string; text?: string }; yolo?: boolean; tool?: string }): void {
  counter += 1
  const id = `t${counter}-${Date.now()}`
  const base = payload.prompt?.name ?? (payload.yolo ? 'yolo' : 'Session')
  terms.value.push({ id, title: `${base} ${counter}`, prompt: payload.prompt, yolo: payload.yolo, tool: payload.tool })
  activeId.value = id
}

function startStartupSession(s: { mode: 'interactive' | 'yolo'; promptName?: string; promptText?: string; tool?: string }): void {
  const prompt = s.promptName ? { name: s.promptName } : s.promptText ? { text: s.promptText } : undefined
  startSession({ prompt, yolo: s.mode === 'yolo', tool: s.tool })
}

defineExpose({ startStartupSession })

function closeTerm(id: string): void {
  const i = terms.value.findIndex((t) => t.id === id)
  if (i === -1) return
  terms.value.splice(i, 1)
  if (activeId.value === id) activeId.value = terms.value.at(-1)?.id ?? null
}

function markExited(id: string): void {
  const t = terms.value.find((t) => t.id === id)
  if (t) t.exited = true
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
          :class="{ 'term-tab--active': t.id === activeId, 'term-tab--dead': t.exited }"
          @click="activeId = t.id"
        >
          {{ t.title }}
          <span class="term-tab__close" @click.stop="closeTerm(t.id)">×</span>
        </button>
      </nav>
      <NewSessionMenu @start="startSession" />
    </div>

    <div class="term-body">
      <div v-if="!terms.length" class="panel-empty">No sessions — start one with "New session".</div>
      <div
        v-for="t in terms"
        v-show="t.id === activeId"
        :key="t.id"
        class="term-slot"
      >
        <TerminalView :id="t.id" :ticket-key="activeTicketKey" :prompt="t.prompt" :yolo="t.yolo" :tool="t.tool" @exited="markExited(t.id)" />
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
.term-tab--dead { color: var(--ink-muted); text-decoration: line-through; }
.term-tab__close { margin-left: 6px; color: var(--ink-muted); }
.term-body { flex: 1; position: relative; overflow: hidden; }
.term-slot { position: absolute; inset: 0; padding: 6px; }
</style>
