<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Ticket } from '../../../shared/types'
import TicketView from './TicketView.vue'

const keyInput = ref('')
const tabs = ref<Ticket[]>([])
const activeKey = ref<string | null>(null)
const emit = defineEmits<{ (e: 'active-ticket', key: string | null): void }>()
watch(activeKey, (k) => emit('active-ticket', k))
const error = ref<string | null>(null)

async function openKey(rawKey: string): Promise<void> {
  const key = rawKey.trim().toUpperCase()
  error.value = null
  if (!key) return
  const existing = tabs.value.find((t) => t.key === key)
  if (existing) { activeKey.value = existing.key; return }
  const res = await window.api.getTicket(key)
  if (res.ok) { tabs.value.push(res.ticket); activeKey.value = res.ticket.key }
  else { error.value = res.error }
}

async function openTicket(): Promise<void> {
  const key = keyInput.value
  await openKey(key)
  keyInput.value = ''
}

async function openTickets(keys: string[]): Promise<void> {
  for (const k of keys) await openKey(k)
  if (keys.length) activeKey.value = keys[0].toUpperCase()
}

defineExpose({ openTickets })

function closeTab(key: string): void {
  const i = tabs.value.findIndex((t) => t.key === key)
  if (i === -1) return
  tabs.value.splice(i, 1)
  if (activeKey.value === key) activeKey.value = tabs.value.at(-1)?.key ?? null
}

const activeTicket = computed<Ticket | undefined>(() =>
  tabs.value.find((t) => t.key === activeKey.value)
)
</script>

<template>
  <section class="left-panel">
    <div class="opener">
      <input
        v-model="keyInput"
        placeholder="Ticket key (e.g. PROJ-123)"
        @keyup.enter="openTicket"
      />
      <button @click="openTicket">Open</button>
    </div>
    <p v-if="error" class="opener__error">{{ error }}</p>

    <nav class="tabs">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="tab"
        :class="{ 'tab--active': t.key === activeKey }"
        @click="activeKey = t.key"
      >
        {{ t.key }}
        <span class="tab__close" @click.stop="closeTab(t.key)">×</span>
      </button>
    </nav>

    <div class="left-body">
      <TicketView v-if="activeTicket" :ticket="activeTicket!" />
      <div v-else class="panel-empty">Open a ticket to start</div>
    </div>
  </section>
</template>

<style scoped>
.opener { display: flex; gap: 8px; padding: 10px; border-bottom: 1px solid var(--hairline); }
.opener input {
  flex: 1; background: var(--surface); color: var(--ink);
  border: 1px solid var(--hairline-strong); border-radius: var(--radius-sm); padding: 6px 10px;
}
.opener input::placeholder { color: var(--ink-muted); }
.opener input:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; border-color: transparent; }
.opener button {
  background: var(--teal); color: var(--bg); border: 0;
  border-radius: var(--radius-sm); padding: 6px 14px; cursor: pointer; font-weight: 600;
}
.opener__error { color: var(--rust); margin: 6px 10px 0; font-size: 13px; }
.tabs { display: flex; gap: 4px; padding: 8px 10px 0; flex-wrap: wrap; }
.tab {
  background: var(--surface); color: var(--ink-soft);
  border: 1px solid var(--hairline); border-bottom: 0;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0; padding: 5px 10px; cursor: pointer;
}
.tab--active { background: var(--surface-2); color: var(--ink); }
.tab__close { margin-left: 6px; color: var(--ink-muted); }
.left-body { flex: 1; overflow: auto; }
</style>
