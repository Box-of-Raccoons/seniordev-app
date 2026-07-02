<script setup lang="ts">
import { ref } from 'vue'
import LeftPanel from './components/LeftPanel.vue'
import RightPanel from './components/RightPanel.vue'

const activeTicketKey = ref<string | null>(null)
</script>

<template>
  <div class="shell">
    <LeftPanel @active-ticket="activeTicketKey = $event" />
    <RightPanel :active-ticket-key="activeTicketKey" />
  </div>
</template>
