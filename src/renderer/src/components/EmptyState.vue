<!-- src/renderer/src/components/EmptyState.vue -->
<script setup lang="ts">
defineProps<{ image: string; caption: string }>()
</script>

<template>
  <div class="panel-empty empty-state">
    <img class="empty-state__art" :src="image" alt="" />
    <p class="empty-state__caption">{{ caption }}</p>
  </div>
</template>

<style scoped>
.empty-state {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  padding: 16px;
  animation: empty-state-in 0.45s var(--ease-out) both;
}
.empty-state__art { width: min(220px, 55%, 35vh); height: auto; }
.empty-state__caption { margin: 0; }
@keyframes empty-state-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .empty-state { animation: none; }
}
</style>
