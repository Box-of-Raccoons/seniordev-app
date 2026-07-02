<script setup lang="ts">
import { onMounted, ref } from 'vue'
import LeftPanel from './components/LeftPanel.vue'
import RightPanel from './components/RightPanel.vue'

const activeTicketKey = ref<string | null>(null)
const leftPanel = ref<InstanceType<typeof LeftPanel> | null>(null)
const rightPanel = ref<InstanceType<typeof RightPanel> | null>(null)

onMounted(async () => {
  try {
    const startup = await window.api.getStartup()
    if (startup.tickets.length) {
      await leftPanel.value?.openTickets(startup.tickets)
      activeTicketKey.value = startup.tickets[0]
    }
    if (startup.session) rightPanel.value?.startStartupSession(startup.session)
  } catch (err) {
    // Startup is best-effort: fall back to an empty workbench the user drives manually.
    console.error('Startup load failed:', err)
  }
})
</script>

<template>
  <div class="shell">
    <LeftPanel ref="leftPanel" @active-ticket="activeTicketKey = $event" />
    <RightPanel ref="rightPanel" :active-ticket-key="activeTicketKey" />
  </div>
</template>
