<!-- src/renderer/src/components/Splash.vue -->
<script setup lang="ts">
import splashUrl from '../assets/splash.png'
</script>

<template>
  <div class="splash" role="status" aria-live="polite" aria-label="SeniorDev is starting">
    <!-- Natural size (1344×768) declared so the box keeps the art's aspect ratio;
         CSS max constraints scale it down without stretching. alt="" — decorative,
         the aria-label above carries the meaning. -->
    <img class="splash__art" :src="splashUrl" alt="" width="1344" height="768" />
    <span class="splash__spinner" aria-hidden="true"></span>
  </div>
</template>

<style scoped>
.splash {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 28px;
  /* Same dark background as the window (--bg) so the splash → app handoff never
     flashes an unstyled/white frame. */
  background: var(--bg);
}
.splash__art {
  /* width/height auto against max constraints preserves the 1344×768 ratio —
     no stretch — and downscales crisply on HiDPI / fractional scaling. */
  width: auto;
  height: auto;
  max-width: min(70vw, 720px);
  max-height: 60vh;
  object-fit: contain;
  border-radius: var(--radius);
}
.splash__spinner {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 3px solid var(--hairline-strong);
  border-top-color: var(--teal);
  animation: splash-spin 0.8s linear infinite;
}
@keyframes splash-spin {
  to { transform: rotate(360deg); }
}

/* Fade the splash out on leave (v-if via <Transition name="splash-fade">) so the
   handoff to the workbench is a crossfade, not an abrupt swap. No enter
   transition: the splash is present from the first paint. */
.splash-fade-leave-active { transition: opacity 320ms var(--ease-out); }
.splash-fade-leave-to { opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .splash__spinner { animation: none; }
  .splash-fade-leave-active { transition: none; }
}
</style>
