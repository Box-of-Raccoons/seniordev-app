<!-- src/renderer/src/components/Splash.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import splashUrl from '../assets/splash.png'

// The version rides in from the main process (same source as the About dialog);
// the splash never blocks on it — it just fills in the line once resolved.
const version = ref('')
// Copyright year, frozen at build time via Vite `define` (see electron.vite.config.ts).
const buildYear = __BUILD_YEAR__

onMounted(async () => {
  try {
    version.value = (await window.api.getAppInfo()).version
  } catch {
    // Best-effort: leave the placeholder if the query fails. The splash must
    // never hang waiting on app info.
  }
})
</script>

<template>
  <div class="splash" role="status" aria-live="polite" aria-label="SeniorDev is starting">
    <!-- The art is a cream illustration with the raccoon in the right half; the
         wordmark/version/credit sit over the open left column. Natural 1344×768
         declared so the box keeps the art's aspect ratio. alt="" — decorative,
         the aria-label carries the meaning; the text below is real DOM text. -->
    <div class="splash__frame">
      <img class="splash__art" :src="splashUrl" alt="" width="1344" height="768" />
      <div class="splash__meta">
        <p class="splash__wordmark">SeniorDev</p>
        <span class="splash__rule" aria-hidden="true"></span>
        <p class="splash__version">version {{ version || '…' }}</p>
        <p class="splash__credit">Box of Raccoons LLC, {{ buildYear }}</p>
      </div>
      <!-- Indeterminate loader: a segment scrolls across the track on a loop.
           Sits in the bottom third of the card, aligned under the text and clear
           of the raccoon. Decorative — role="status" above carries the meaning. -->
      <div class="splash__loader" aria-hidden="true"></div>
    </div>
  </div>
</template>

<style scoped>
.splash {
  /* Dark-on-cream overlay ink. The global --ink ramp is built for the dark UI
     (it's light) and would be invisible on the cream art, so the splash carries
     its own charcoal ramp — all three tones clear 4.5:1 on the ~#f0ede0 art. */
  --splash-ink: oklch(0.30 0.03 165);
  --splash-ink-muted: oklch(0.44 0.02 165);
  --splash-accent: oklch(0.62 0.1 168);

  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  /* Same dark background as the window (--bg) so the splash → app handoff never
     flashes an unstyled/white frame. */
  background: var(--bg);
}
.splash__frame {
  /* A definite width (honouring both the 70vw/720px width cap AND the 60vh
     height cap, the latter re-expressed as a width via the 1344/768 ratio, i.e.
     60vh × 1.75 = 105vh) is required so `container-type: inline-size` has a real
     size to measure — the overlay's cqw units then scale the text with the art,
     never the viewport, so it can't drift over the raccoon at any window size.
     (inline-size containment stops the box from sizing to its content, so a
     shrink-wrapped frame would collapse to zero — hence the explicit width.) */
  position: relative;
  width: min(70vw, 720px, 105vh);
  aspect-ratio: 1344 / 768;
  container-type: inline-size;
  border-radius: var(--radius);
  overflow: hidden;
}
.splash__art {
  /* Fills the ratio-locked frame; contain guards against sub-pixel overflow and
     downscales crisply on HiDPI / fractional scaling. */
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.splash__meta {
  /* Left column of the art — the raccoon lives in the right ~45%, so the text
     stays clear of it. Vertically centred, left-aligned. */
  position: absolute;
  inset: 0;
  width: 56%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  padding: 6cqw 0 6cqw 7cqw;
  text-align: left;
}
.splash__wordmark {
  margin: 0;
  font-size: clamp(22px, 6.4cqw, 46px);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.02;
  white-space: nowrap;
  color: var(--splash-ink);
}
.splash__rule {
  display: block;
  width: clamp(28px, 8cqw, 58px);
  height: 2px;
  margin: clamp(6px, 1.4cqw, 12px) 0 clamp(8px, 1.8cqw, 14px);
  border-radius: 2px;
  background: var(--splash-accent);
}
.splash__version {
  margin: 0;
  font-size: clamp(11px, 2.1cqw, 15px);
  font-weight: 500;
  letter-spacing: 0.01em;
  color: var(--splash-ink-muted);
}
.splash__credit {
  margin: clamp(10px, 2.4cqw, 18px) 0 0;
  font-size: clamp(10px, 1.7cqw, 13px);
  font-weight: 400;
  color: var(--splash-ink-muted);
}
.splash__loader {
  position: absolute;
  left: 7cqw;
  bottom: 9cqw;
  width: 42cqw;
  height: 3px;
  border-radius: 999px;
  overflow: hidden;
  /* Faint track in the art's own charcoal, so the moving segment reads clearly. */
  background: color-mix(in oklab, var(--splash-ink) 15%, transparent);
}
.splash__loader::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  width: 40%;
  border-radius: inherit;
  background: var(--splash-accent);
  /* Scroll the segment across the track and off the far edge, on a loop. */
  animation: splash-scroll 1.3s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}
@keyframes splash-scroll {
  from { transform: translateX(-100%); }
  to { transform: translateX(250%); }
}

/* The meta lines rise in on first paint — a short, staggered settle, not a
   loud entrance; the art is already present. */
.splash__wordmark,
.splash__rule,
.splash__version,
.splash__credit {
  animation: splash-rise 560ms var(--ease-out) both;
}
.splash__wordmark { animation-delay: 60ms; }
.splash__rule { animation-delay: 140ms; }
.splash__version { animation-delay: 200ms; }
.splash__credit { animation-delay: 280ms; }
@keyframes splash-rise {
  from { opacity: 0; transform: translateY(0.5em); }
  to { opacity: 1; transform: none; }
}

/* Fade the splash out on leave (v-if via <Transition name="splash-fade">) so the
   handoff to the workbench is a crossfade, not an abrupt swap. No enter
   transition: the splash is present from the first paint. */
.splash-fade-leave-active { transition: opacity 320ms var(--ease-out); }
.splash-fade-leave-to { opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  /* No scroll — show a static, full-width segment so "loading" still reads. */
  .splash__loader::before { animation: none; width: 100%; transform: none; opacity: 0.7; }
  .splash-fade-leave-active { transition: none; }
  .splash__wordmark,
  .splash__rule,
  .splash__version,
  .splash__credit { animation: none; }
}
</style>
