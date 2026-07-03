<!-- src/renderer/src/components/PrCard.vue -->
<script setup lang="ts">
const props = defineProps<{ url: string; term: string }>()
function open(): void {
  void window.api.openExternal(props.url).catch(() => {})
}
</script>

<template>
  <div class="pr-card">
    <span class="pr-card__label">✅ {{ term }} ready</span>
    <button class="pr-card__open" @click="open">Open</button>
  </div>
</template>

<style scoped>
.pr-card {
  display: flex; align-items: center; gap: 10px; justify-content: space-between;
  padding: 8px 12px; background: color-mix(in oklch, var(--green) 14%, var(--surface));
  border: 1px solid color-mix(in oklch, var(--green) 40%, var(--hairline-strong));
  border-radius: var(--radius-sm); margin: 0 0 6px;
}
.pr-card__label { color: var(--ink); font-weight: 600; }
.pr-card__open {
  background: var(--teal); color: var(--bg); border: 0;
  border-radius: var(--radius-sm); padding: 5px 14px; cursor: pointer; font-weight: 600;
}
.pr-card__open:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
</style>
